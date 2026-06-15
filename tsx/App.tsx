
import React, { useState, useCallback, useRef } from 'react';
import { processTextFile, analyzeDeductions, parseTxtContent, parseFractionToDecimal, parseLengthToInches, type ProcessResult, type DeductionCandidate, type DrawingTubeItem, type TxtLineParsed } from '../ts/fileProcessor';
import { UploadCloud, FileText, Play, Download, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';

// Define the valid states for the main application flow
type AppState = 'initial' | 'file-loaded' | 'reviewing-deductions' | 'processing' | 'processed';

const App: React.FC = () => {
  // State for raw and rounded values
  const [originalContent, setOriginalContent] = useState<string>('');
  const [processedContent, setProcessedContent] = useState<string>('');
  
  // File detail states
  const [fileName, setFileName] = useState<string>('');
  const [outputFileName, setOutputFileName] = useState<string>('');
  
  // App UI states
  const [error, setError] = useState<string>('');
  const [appState, setAppState] = useState<AppState>('initial');
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState<string>('');
  
  // Output logs and prompt data
  const [changesLog, setChangesLog] = useState<ProcessResult['changes']>([]);
  const [deductions, setDeductions] = useState<DeductionCandidate[]>([]);

  // Drawing Verification states
  const [isCrossCheckModalOpen, setIsCrossCheckModalOpen] = useState(false);
  const [crossCheckMode, setCrossCheckMode] = useState<'upload' | 'paste'>('upload');
  const [crossCheckPastedText, setCrossCheckPastedText] = useState('');
  const [isExtractingDrawing, setIsExtractingDrawing] = useState(false);
  const [drawingTubes, setDrawingTubes] = useState<DrawingTubeItem[]>([]);
  const [drawingFileName, setDrawingFileName] = useState('');
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Handle the file upload via drag-drop or file picker.
   * Reads .txt files locally using FileReader API.
   */
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setOriginalContent(text);
        setFileName(file.name);
        setOutputFileName(`processed_${file.name}`);
        setProcessedContent('');
        setError('');
        setAppState('file-loaded');
        setChangesLog([]);
        setDeductions([]);
      };
      reader.onerror = () => {
        setError('Failed to read the file.');
        setAppState('initial');
      };
      reader.readAsText(file);
    } else {
      setError('Please upload a valid .txt file.');
      setAppState('initial');
    }
  }, []);

  /**
   * Handle the PDF drawing upload for cross checking.
   */
  const handlePDFChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const newFileName = files.length === 1 ? files[0].name : `${files.length} PDFs`;
    setDrawingFileName(prev => prev ? `${prev}, ${newFileName}` : newFileName);
    setIsExtractingDrawing(true);
    setError('');

    try {
      const allExtractedTubes: DrawingTubeItem[] = [];
      const errors: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type !== 'application/pdf') {
          console.warn(`Skipping non-PDF file: ${file.name}`);
          continue;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
          const response = await fetch('/api/extract-drawing', {
            method: 'POST',
            body: formData,
          });
          
          let data;
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
             data = await response.json();
          } else {
             const textText = await response.text();
             throw new Error(`Server error ${response.status}: ${textText.slice(0, 100)}...`);
          }

          if (!response.ok) {
            errors.push(`File ${file.name}: ${data.error || 'Failed to extract data'}`);
            continue;
          }
          
          if (data && data.tubes && data.tubes.length > 0) {
            allExtractedTubes.push(...data.tubes);
          } else {
            errors.push(`File ${file.name}: No tube data could be extracted.`);
          }
        } catch (err: any) {
          errors.push(`File ${file.name}: ${err.message || 'Network error'}`);
        }
      }

      if (allExtractedTubes.length > 0) {
        setDrawingTubes(prev => {
           // Basic deduplication by part number
           const existing = [...prev];
           for (const tube of allExtractedTubes) {
               const idx = existing.findIndex(t => t.partNumber === tube.partNumber);
               if (idx >= 0) existing[idx] = tube;
               else existing.push(tube);
           }
           return existing;
        });
        if (errors.length > 0) {
          setError(`Partially succeeded. Errors: ${errors.join(' | ')}`);
        } else {
          setIsCrossCheckModalOpen(false);
        }
      } else {
        setError(`No tube data could be extracted. Errors: ${errors.join(' | ')}`);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred');
    } finally {
      setIsExtractingDrawing(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  /**
   * Handle the pasted text drawing information.
   */
  const handlePastedCrossCheck = async () => {
    if (!crossCheckPastedText.trim()) {
      setError('Please paste the drawing table text first.');
      return;
    }

    setDrawingFileName(prev => prev ? `${prev}, Pasted Text` : 'Pasted Table Text');
    setIsExtractingDrawing(true);
    setError('');

    try {
      const response = await fetch('/api/extract-text-table', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: crossCheckPastedText }),
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract data from the pasted text');
      }
      
      if (data && data.tubes) {
        setDrawingTubes(prev => {
           const existing = [...prev];
           for (const tube of data.tubes) {
               const idx = existing.findIndex(t => t.partNumber === tube.partNumber);
               if (idx >= 0) existing[idx] = tube;
               else existing.push(tube);
           }
           return existing;
        });
        setIsCrossCheckModalOpen(false);
        setCrossCheckPastedText('');
      } else {
        setError('No tube data could be extracted from the provided text.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred');
    } finally {
      setIsExtractingDrawing(false);
    }
  };

  /**
   * Reset processed data when user modifies original content directly.
   */
  const handleOriginalContentChange = useCallback((value: string) => {
    setOriginalContent(value);
    if (appState === 'processed' || appState === 'reviewing-deductions') {
      setAppState('file-loaded');
      setProcessedContent('');
      setChangesLog([]);
      setDeductions([]);
    }
  }, [appState]);

  // Handle manual code pasting submission
  const handleConfirmPaste = useCallback(() => {
    if (!pastedText.trim()) {
      setError('Please enter or paste some text first.');
      return;
    }
    setOriginalContent(pastedText);
    setFileName('pasted_input.txt');
    setOutputFileName('processed_pasted_input.txt');
    setProcessedContent('');
    setError('');
    // Switch to file-loaded mode directly logic
    setAppState('file-loaded');
    setChangesLog([]);
    setDeductions([]);
  }, [pastedText]);

  const handleLoadSample = () => {
    setPastedText(
`49558-4001          078.7500    088.2958    FA    FP    0.688    572.7500
49558-4003          088.4042    094.2917    FA    FP    0.688    353.2500
49558-4005          094.6671    102.3380    FA    S     0.813    460.2500
49558-4007          102.7384    109.9926    FA    B9    0.938    435.2500
49558-4009          110.1426    114.0676    FA    X     0.938    235.5000`
    );
    setError('');
  };

  const executeProcessing = useCallback((activeDeductionLines: Set<number>) => {
    setAppState('processing');
    setError('');
    setTimeout(() => {
      try {
        const result = processTextFile(originalContent, activeDeductionLines);
        setProcessedContent(result.processedContent);
        setChangesLog(result.changes);
        setAppState('processed');
      } catch (err) {
        setError('An error occurred during processing. Please check the file format.');
        setAppState('file-loaded');
      }
    }, 500);
  }, [originalContent]);

  const handleProcessFile = useCallback(() => {
    if (!originalContent) return;
    
    if (appState === 'file-loaded') {
      const candidates = analyzeDeductions(originalContent);
      if (candidates.length > 0) {
        setDeductions(candidates);
        setAppState('reviewing-deductions');
        return;
      }
    }
    
    executeProcessing(new Set());
  }, [originalContent, appState, executeProcessing]);

  const handleConfirmDeductions = () => {
    const activeSets = new Set(deductions.filter(d => d.selected).map(d => d.lineNumber));
    executeProcessing(activeSets);
  };

  const handleDownloadFile = () => {
    if (!processedContent) return;
    const blob = new Blob([processedContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outputFileName || `processed_${fileName || 'file.txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setOriginalContent('');
    setProcessedContent('');
    setFileName('');
    setOutputFileName('');
    setPastedText('');
    setChangesLog([]);
    setDeductions([]);
    setDrawingTubes([]);
    setDrawingFileName('');
    setError('');
    setAppState('initial');
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
    if (pdfInputRef.current) {
        pdfInputRef.current.value = '';
    }
  };
  
  const triggerFileSelect = () => fileInputRef.current?.click();

  return (
    <div className="bg-neutral-900 text-neutral-200 min-h-screen font-sans flex flex-col items-center p-4 sm:p-8">
      <header className="w-full max-w-6xl text-center mb-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-500">
          Fractional Inch Rounder
        </h1>
        <p className="text-neutral-400 mt-2 max-w-2xl mx-auto">
          Upload a TXT file or input text directly. The app automatically detects any decimal measurements (regardless of column format) and rounds them to the nearest 1/32", preserving all original structural formatting.
        </p>
      </header>

      <main className="w-full max-w-6xl flex-grow flex flex-col items-center">
        {error && <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-2 rounded-md mb-4 text-sm">{error}</div>}
        
        {appState === 'initial' && (
          <div className="w-full max-w-3xl mb-8">
            {/* Input Selection Tabs */}
            <div className="flex border-b border-neutral-700 mb-6 font-medium">
              <button
                type="button"
                onClick={() => { setInputMode('upload'); setError(''); }}
                className={`flex-1 py-3 text-center border-b-2 transition-all font-semibold ${
                  inputMode === 'upload'
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Upload File
              </button>
              <button
                type="button"
                onClick={() => { setInputMode('paste'); setError(''); }}
                className={`flex-1 py-3 text-center border-b-2 transition-all font-semibold ${
                  inputMode === 'paste'
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Paste / Enter Text
              </button>
            </div>

            {inputMode === 'upload' ? (
              <div 
                className="w-full bg-neutral-800 border-2 border-dashed border-neutral-600 rounded-xl p-12 text-center cursor-pointer transition-all hover:border-orange-500 hover:bg-neutral-700"
                onClick={triggerFileSelect}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) { fileInputRef.current!.files = e.dataTransfer.files; handleFileChange({ target: fileInputRef.current } as any); } }}
              >
                <UploadCloud className="mx-auto h-12 w-12 text-neutral-500" />
                <p className="mt-4 text-lg font-semibold text-neutral-300">Drag & drop a .txt file here</p>
                <p className="mt-1 text-sm text-neutral-500">or click to select a file</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".txt"
                  className="hidden"
                />
              </div>
            ) : (
              <div className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-6 flex flex-col space-y-4">
                <label className="block text-sm font-medium text-neutral-300">
                  Enter columns of data (any decimal measurements will be auto-detected & rounded):
                </label>
                <textarea
                  wrap="off"
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  className="w-full h-64 bg-neutral-950 border border-neutral-700 rounded-lg p-4 font-mono text-xs sm:text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 whitespace-pre overflow-x-auto"
                  placeholder={`Example layout:
49558-4001          078.7500    088.2958    FA    FP    0.688    572.7500
49558-4003          088.4042    094.2917    FA    FP    0.688    353.2500
49558-4005          094.6671    102.3380    FA    FP    0.813    460.2500
49558-4007          102.7384    109.9926    FA    FP    0.938    435.2500
49558-4009          110.1426    114.0676    FA    B9    0.938    235.5000`}
                />
                <div className="flex gap-3 justify-end pt-2">
                  <button 
                    onClick={handleLoadSample}
                    className="px-4 py-2 text-sm text-neutral-300 hover:text-white bg-neutral-700 hover:bg-neutral-600 font-semibold rounded-md transition-colors"
                  >
                    Load Sample
                  </button>
                  <button
                    onClick={handleConfirmPaste}
                    disabled={!pastedText.trim()}
                    className="bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 px-6 rounded-md transition-colors disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed"
                  >
                    Load Text
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {appState !== 'initial' && (
          <div className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-4 flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
            <div className="flex items-center w-full md:w-auto overflow-hidden">
              <FileText className="h-6 w-6 text-orange-400 mr-3 flex-shrink-0" />
              <span className="font-medium text-neutral-200 truncate">{fileName}</span>
            </div>
            <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 w-full md:w-auto">
              
              <div className="mr-4 group relative inline-block">
                  <button 
                    onClick={() => setIsCrossCheckModalOpen(true)}
                    className="flex items-center text-sm font-semibold bg-blue-900 border border-blue-700 hover:bg-blue-800 text-blue-100 py-2 px-4 rounded-md transition-colors"
                  >
                     Cross-Check with Drawing
                  </button>
              </div>

              {appState !== 'reviewing-deductions' && (
                <button 
                  onClick={handleProcessFile} 
                  disabled={appState === 'processing' || appState === 'processed'}
                  className="flex items-center bg-orange-600 text-white font-bold py-2 px-4 rounded-md transition-colors hover:bg-orange-500 disabled:bg-neutral-600 disabled:cursor-not-allowed">
                  {appState === 'processing' ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5 mr-2" />
                      Process File
                    </>
                  )}
                </button>
              )}
              {appState === 'processed' && (
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    type="text"
                    value={outputFileName}
                    onChange={(e) => setOutputFileName(e.target.value)}
                    className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 w-[140px] sm:w-[200px] font-mono"
                    placeholder="Output file name.txt"
                  />
                  <button onClick={handleDownloadFile} className="flex items-center bg-green-600 text-white font-bold py-2 px-4 rounded-md transition-colors hover:bg-green-500">
                    <Download className="h-5 w-5 mr-2" />
                    Download
                  </button>
                </div>
              )}
              <button onClick={handleReset} className="flex items-center bg-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors hover:bg-red-600">
                <Trash2 className="h-5 w-5 mr-2" />
                Start Over
              </button>
            </div>
          </div>
        )}
        
        {appState === 'reviewing-deductions' && (
          <div className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-6 flex flex-col flex-grow shadow-2xl">
              <div className="mb-6 flex flex-col">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-xl font-semibold text-neutral-400">Original Content</h2>
                  <span className="text-xs text-neutral-500 bg-neutral-950 px-2.5 py-1 rounded border border-neutral-800 font-medium select-none">Read-only Comparison</span>
                </div>
                <textarea
                  wrap="off"
                  readOnly
                  value={originalContent}
                  className="bg-neutral-950 border border-neutral-700 rounded-lg p-4 w-full h-64 font-mono text-xs sm:text-sm text-neutral-300 focus:outline-none whitespace-pre overflow-x-auto resize-y min-h-[150px]"
                />
              </div>

              <h2 className="text-2xl font-bold text-neutral-200 mb-2 border-t border-neutral-700 pt-6">Column 7 Deductions Detected</h2>
              <p className="text-neutral-400 mb-6 mt-2">
                  The following lines contain <span className="font-bold text-white">FP</span>, <span className="font-bold text-white">B9</span>, or <span className="font-bold text-white">S</span> in column 5. You can choose to automatically subtract <span className="font-mono text-orange-400">-0.1875</span> from their 7th column measurement before rounding.
              </p>
              
              <div className="flex justify-between items-center mb-4 border-b border-neutral-700 pb-4">
                  <div className="flex space-x-4">
                    <button
                        onClick={() => setDeductions(d => d.map(x => ({...x, selected: true})))}
                        className="text-sm font-semibold text-orange-400 hover:text-orange-300 transition"
                    >Select All</button>
                    <button
                        onClick={() => setDeductions(d => d.map(x => ({...x, selected: false})))}
                        className="text-sm font-semibold text-neutral-400 hover:text-neutral-300 transition"
                    >Deselect All</button>
                  </div>
                  <span className="text-sm text-neutral-500">{deductions.filter(d => d.selected).length} of {deductions.length} selected</span>
              </div>
              
              <div className="flex-grow overflow-y-auto pr-4 space-y-3 max-h-[500px]">
                  {deductions.map((deduction, i) => (
                      <label key={i} className="flex items-start sm:items-center space-x-4 bg-neutral-900/80 border border-neutral-700 p-4 rounded-xl cursor-pointer hover:bg-neutral-800 hover:border-neutral-500 transition shadow-inner">
                          <input type="checkbox" checked={deduction.selected} onChange={(e) => {
                              const newD = [...deductions];
                              newD[i].selected = e.target.checked;
                              setDeductions(newD);
                          }} className="w-5 h-5 mt-1 sm:mt-0 rounded border-neutral-600 text-orange-500 focus:ring-orange-500 bg-neutral-700 cursor-pointer" />
                          <div className="flex-grow font-mono text-sm overflow-hidden text-ellipsis">
                              <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-1 sm:space-y-0 mb-3">
                                   <span className="text-neutral-400 w-20 flex-shrink-0">Line {deduction.lineNumber}</span>
                                   <span className="text-neutral-300">Col 5: <strong className="text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">{deduction.col5Value}</strong></span>
                                   <span className="text-neutral-300">Col 7: <strong className="text-red-400 line-through bg-red-400/10 px-1 py-0.5 rounded">{deduction.col7Value}</strong> <span className="text-neutral-500 mx-1">&rarr;</span> <strong className="text-green-400 bg-green-400/10 px-2 py-0.5 rounded">{deduction.selected ? (deduction.col7Number - 0.1875).toFixed(4) : deduction.col7Value}</strong></span>
                              </div>
                              <div className="text-neutral-600 text-xs whitespace-pre overflow-x-auto pb-1 bg-black/40 p-2 rounded">
                                  {deduction.originalLine}
                              </div>
                          </div>
                      </label>
                  ))}
              </div>
              
              <div className="flex justify-end mt-6 space-x-4 border-t border-neutral-700 pt-6">
                  <button onClick={() => setAppState('file-loaded')} className="px-6 py-2 bg-neutral-700 text-white rounded-md font-bold hover:bg-neutral-600 transition">Cancel</button>
                  <button onClick={handleConfirmDeductions} className="px-6 py-2 bg-orange-600 text-white rounded-md font-bold hover:bg-orange-500 transition shadow-lg shadow-orange-900/50">
                      Confirm & Continue Processing
                  </button>
              </div>
          </div>
        )}

        {drawingTubes.length > 0 && (
          <div className="w-full mb-6 bg-neutral-800 border border-neutral-700 rounded-lg p-6 flex flex-col shadow-xl">
             <div className="flex justify-between items-center mb-4 pb-4 border-b border-neutral-700">
                <div>
                   <h2 className="text-xl font-bold text-neutral-200">PDF Cross-Check Report</h2>
                   <p className="text-sm text-neutral-400 mt-1">Comparing "{drawingFileName}" against the current text layout.</p>
                </div>
                <button onClick={() => { setDrawingTubes([]); setDrawingFileName(''); }} className="text-sm text-neutral-400 hover:text-white">Clear</button>
             </div>
             
             <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                   <thead className="bg-neutral-900/50 text-neutral-400 text-xs uppercase font-semibold">
                      <tr>
                         <th className="px-4 py-3 border-b border-neutral-700">Part No.</th>
                         <th className="px-4 py-3 border-b border-neutral-700">Thickness</th>
                         <th className="px-4 py-3 border-b border-neutral-700">Top Dia</th>
                         <th className="px-4 py-3 border-b border-neutral-700">Bottom Dia</th>
                         <th className="px-4 py-3 border-b border-neutral-700">Length</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-neutral-700/50">
                      {drawingTubes.map((tube, idx) => {
                         const txtData = parseTxtContent(originalContent).find(t => t.partNumber === tube.partNumber);
                         
                         const pdThick = parseFractionToDecimal(tube.thickness);
                         const pdTop = parseFractionToDecimal(tube.topDia);
                         const pdBot = parseFractionToDecimal(tube.bottomDia);
                         const pdLen = parseLengthToInches(tube.length);

                         const matchVal = (pdfVal: number | null, txtVal: number | null) => {
                            if (pdfVal === null || txtVal === null) return null;
                            return Math.abs(pdfVal - txtVal) < 0.05; // 0.05 tolerance for rounding
                         };

                         const thMatch = matchVal(pdThick, txtData?.thickness ?? null);
                         const isThickMatch = thMatch === true;
                         const topMatch = matchVal(pdTop, txtData?.topDia ?? null);
                         const botMatch = matchVal(pdBot, txtData?.bottomDia ?? null);
                         const lenMatch = matchVal(pdLen, txtData?.length ?? null);

                         return (
                           <tr key={idx} className="bg-neutral-800/20 hover:bg-neutral-800 transition-colors">
                              <td className="px-4 py-3 font-mono text-neutral-300 font-semibold">{tube.partNumber}</td>
                              <td className="px-4 py-3">
                                 <div className="flex flex-col">
                                   <span className="text-neutral-400 text-xs">PDF: {tube.thickness} <span className="opacity-50">({pdThick?.toFixed(4)})</span></span>
                                   <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-white font-mono">{txtData?.thickness ?? 'N/A'}</span>
                                      {txtData && (isThickMatch ? <CheckCircle className="w-4 h-4 text-green-500"/> : <AlertTriangle className="w-4 h-4 text-red-500"/>)}
                                   </div>
                                 </div>
                              </td>
                              <td className="px-4 py-3">
                                 <div className="flex flex-col">
                                   <span className="text-neutral-400 text-xs">PDF: {tube.topDia} <span className="opacity-50">({pdTop?.toFixed(4)})</span></span>
                                   <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-white font-mono">{txtData?.topDia ?? 'N/A'}</span>
                                      {txtData && (topMatch === true ? <CheckCircle className="w-4 h-4 text-green-500"/> : <AlertTriangle className="w-4 h-4 text-red-500"/>)}
                                   </div>
                                 </div>
                              </td>
                              <td className="px-4 py-3">
                                 <div className="flex flex-col">
                                   <span className="text-neutral-400 text-xs">PDF: {tube.bottomDia} <span className="opacity-50">({pdBot?.toFixed(4)})</span></span>
                                   <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-white font-mono">{txtData?.bottomDia ?? 'N/A'}</span>
                                      {txtData && (botMatch === true ? <CheckCircle className="w-4 h-4 text-green-500"/> : <AlertTriangle className="w-4 h-4 text-red-500"/>)}
                                   </div>
                                 </div>
                              </td>
                              <td className="px-4 py-3">
                                 <div className="flex flex-col">
                                   <span className="text-neutral-400 text-xs">PDF: {tube.length} <span className="opacity-50">({pdLen?.toFixed(4)})</span></span>
                                   <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-white font-mono">{txtData?.length ?? 'N/A'}</span>
                                      {txtData && (lenMatch === true ? <CheckCircle className="w-4 h-4 text-green-500"/> : <AlertTriangle className="w-4 h-4 text-red-500"/>)}
                                   </div>
                                 </div>
                              </td>
                           </tr>
                         );
                      })}
                   </tbody>
                </table>
                {!drawingTubes.some(t => parseTxtContent(originalContent).some(c => c.partNumber === t.partNumber)) && (
                   <div className="text-center py-6 text-neutral-400 text-sm">
                      None of the extracted part numbers from the PDF match any part numbers found in the current TXT input. Check if the correct files are uploaded.
                   </div>
                )}
             </div>
          </div>
        )}

        {appState !== 'initial' && appState !== 'reviewing-deductions' && (
          <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6 flex-grow">
            <div className="flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-xl font-semibold text-neutral-400">Original Content</h2>
                <span className="text-xs text-neutral-500 bg-neutral-950 px-2.5 py-1 rounded border border-neutral-800 font-medium select-none">Editable</span>
              </div>
              <textarea
                wrap="off"
                value={originalContent}
                onChange={(e) => handleOriginalContentChange(e.target.value)}
                className="flex-grow min-h-[300px] lg:min-h-[450px] bg-neutral-950 border border-neutral-700 rounded-lg p-4 w-full font-mono text-xs sm:text-sm text-neutral-300 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 whitespace-pre overflow-x-auto"
                placeholder="Original file content will appear here..."
              />
            </div>
            <div className="flex flex-col">
              <h2 className="text-xl font-semibold mb-2 text-neutral-400">Processed Content (1/32" Rounded)</h2>
              <textarea
                wrap="off"
                readOnly
                value={processedContent}
                className="flex-grow min-h-[300px] lg:min-h-[450px] bg-neutral-950 border border-neutral-700 rounded-lg p-4 w-full font-mono text-xs sm:text-sm text-green-300 resize-none focus:outline-none whitespace-pre overflow-x-auto"
                placeholder="Processed content will appear here..."
              />
            </div>
          </div>
        )}

        {appState === 'processed' && changesLog.length > 0 && (
          <div className="w-full mt-6 bg-neutral-800 border border-neutral-700 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4 text-neutral-300 border-b border-neutral-700 pb-2">Change Log</h2>
            <div className="max-h-64 overflow-y-auto space-y-2 pr-2">
              {changesLog.map((change, index) => (
                <div key={index} className="flex flex-col sm:flex-row sm:items-center bg-neutral-900 rounded p-3 text-sm font-mono border border-neutral-800">
                  <span className="text-neutral-500 w-24 flex-shrink-0">Line {change.lineNumber}:</span>
                  <div className="flex items-center space-x-3 mt-1 sm:mt-0 flex-grow">
                    <span className="text-red-400 bg-red-400/10 px-2 py-1 rounded select-all">{change.original}</span>
                    <span className="text-neutral-500">→</span>
                    <span className="text-green-400 bg-green-400/10 px-2 py-1 rounded font-bold select-all">{change.updated}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {appState === 'processed' && changesLog.length === 0 && (
          <div className="w-full mt-6 bg-neutral-800 border border-neutral-700 rounded-lg p-6 mb-8 text-center text-neutral-400">
            No numbers needed rounding (or no valid decimal numbers found).
          </div>
        )}
      </main>

      {/* Cross-Check Modal */}
      {isCrossCheckModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-neutral-800">
              <h2 className="text-xl font-bold text-neutral-200">Cross-Check with Drawing</h2>
              <button 
                onClick={() => setIsCrossCheckModalOpen(false)}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-6 flex-grow overflow-y-auto">
                <div className="flex border-b border-neutral-700 mb-6 font-medium">
                  <button
                    type="button"
                    onClick={() => { setCrossCheckMode('upload'); setError(''); }}
                    className={`flex-1 py-2 text-center border-b-2 transition-all text-sm font-semibold ${
                      crossCheckMode === 'upload'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Upload PDF Drawing
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCrossCheckMode('paste'); setError(''); }}
                    className={`flex-1 py-2 text-center border-b-2 transition-all text-sm font-semibold ${
                      crossCheckMode === 'paste'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Paste Table Text
                  </button>
                </div>

                {crossCheckMode === 'upload' ? (
                   <div 
                      className="w-full bg-neutral-800 border-2 border-dashed border-neutral-600 rounded-xl p-12 text-center cursor-pointer transition-all hover:border-blue-500 hover:bg-neutral-700"
                      onClick={() => pdfInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { 
                        e.preventDefault(); 
                        if (e.dataTransfer.files && pdfInputRef.current) { 
                          pdfInputRef.current.files = e.dataTransfer.files; 
                          handlePDFChange({ target: pdfInputRef.current } as any); 
                        } 
                      }}
                    >
                      <UploadCloud className="mx-auto h-12 w-12 text-neutral-500" />
                      <p className="mt-4 text-sm font-semibold text-neutral-300">Select PDF Drawing</p>
                      <input
                        type="file"
                        ref={pdfInputRef}
                        onChange={handlePDFChange}
                        accept="application/pdf"
                        multiple
                        className="hidden"
                      />
                   </div>
                ) : (
                   <div className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-4 flex flex-col space-y-4">
                      <label className="block text-sm font-medium text-neutral-400">
                        Copy and paste the SHAFT INFORMATION table from the drawing:
                      </label>
                      <textarea
                        wrap="off"
                        value={crossCheckPastedText}
                        onChange={(e) => setCrossCheckPastedText(e.target.value)}
                        className="w-full h-48 bg-neutral-950 border border-neutral-700 rounded-lg p-4 font-mono text-xs sm:text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500 whitespace-pre overflow-x-auto"
                        placeholder="Paste table text here..."
                      />
                      <div className="flex justify-end pt-2">
                         <button
                           onClick={handlePastedCrossCheck}
                           disabled={!crossCheckPastedText.trim() || isExtractingDrawing}
                           className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-md transition-colors disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed"
                         >
                           Extract Information
                         </button>
                      </div>
                   </div>
                )}
                {isExtractingDrawing && (
                    <div className="mt-4 flex items-center justify-center space-x-2 text-blue-400">
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-sm font-medium">Parsing Drawing...</span>
                    </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Footer Credentials */}
      <footer className="w-full max-w-6xl mt-12 py-6 border-t border-neutral-800 text-center text-xs text-neutral-500 font-medium">
        <p className="mb-1">
          Developed by <span className="text-neutral-400 font-semibold">Luis Godinez</span> 
          {' '}(<a href="mailto:luis.godinez@arcosa.com" className="hover:text-orange-400 transition-colors">luis.godinez@arcosa.com</a>)
        </p>
        <p>
          <span className="text-neutral-400">Arcosa Industries de Mexico</span> • Department: Product Engineering
        </p>
      </footer>
    </div>
  );
};

export default App;
