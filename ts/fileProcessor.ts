
/**
 * Rounds a given number to the nearest fraction of 1/32.
 * Uses symmetric rounding so that negative and positive numbers round identically.
 * @param num The number to round.
 * @returns The rounded number.
 */
const roundToNearest32nd = (num: number): number => {
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    const rounded = Math.round(absNum * 32) / 32;
    // Division by 32 (a power of 2) is exact in IEEE 754 floating point.
    return isNegative ? -rounded : rounded;
};

export interface ProcessResult {
    processedContent: string;
    changes: Array<{
        lineNumber: number;
        original: string;
        updated: string;
    }>;
}

export interface DeductionCandidate {
    lineNumber: number;
    originalLine: string;
    col5Value: string;
    col7Value: string;
    col7Number: number;
    selected: boolean;
}

export interface DrawingTubeItem {
    partNumber: string;
    length: string;
    thickness: string;
    topDia: string;
    bottomDia: string;
}

export interface TxtLineParsed {
    lineNumber: number;
    originalLine: string;
    partNumber: string;
    topDia: number | null;
    bottomDia: number | null;
    thickness: number | null;
    length: number | null;
}

/**
 * Helper to parse drawing fractions (e.g., "11/16"" or "64 11/32"") to decimals.
 */
export const parseFractionToDecimal = (val: string): number | null => {
    if (!val) return null;
    // Remove quotes
    const clean: string = val.replace(/"/g, '').trim();
    
    // Check if it has a space (e.g., "64 11/32")
    const parts = clean.split(' ');
    if (parts.length === 2) {
        const whole = parseFloat(parts[0]);
        const frac = parts[1].split('/');
        if (frac.length === 2) {
            return whole + (parseFloat(frac[0]) / parseFloat(frac[1]));
        }
    } else if (parts.length === 1) {
        const frac = parts[0].split('/');
        if (frac.length === 2) {
            return parseFloat(frac[0]) / parseFloat(frac[1]);
        } else {
            return parseFloat(parts[0]); // fallback if no fraction
        }
    }
    return null;
};

/**
 * Parses lengths like "50'-0"" into inches.
 */
export const parseLengthToInches = (val: string): number | null => {
    if (!val) return null;
    const clean: string = val.replace(/"/g, '').trim();
    const parts = clean.split("'-");
    if (parts.length === 2) {
        const feet = parseFloat(parts[0]);
        const inches = parseFloat(parts[1]);
        return (feet * 12) + inches;
    }
    const singleFootMatch = clean.match(/^(\d+)'$/);
    if (singleFootMatch) {
       return parseFloat(singleFootMatch[1]) * 12;
    }
    return null;
};

/**
 * Extracts basic known values from the TXT lines for cross check.
 */
export const parseTxtContent = (content: string): TxtLineParsed[] => {
    const lines = content.split(/\r?\n/);
    const parsed: TxtLineParsed[] = [];
    
    lines.forEach((line, index) => {
        if (!line.trim()) return;
        
        const tokens = line.trim().split(/[\s,;\t]+/);
        // Typical structure: Tube No (0), Top Dia (1), Bot Dia (2), ..., Thickness, Length
        if (tokens.length >= 6) {
            const partNumber = tokens[0];
            const topDia = parseFloat(tokens[1]);
            const bottomDia = parseFloat(tokens[2]);
            
            // Infer thickness and length from the end of the tokens (they might have 6 or 7 tokens)
            // Often length is the last token, thickness is second to last
            const lenStr = tokens[tokens.length - 1];
            const thickStr = tokens[tokens.length - 2];
            
            parsed.push({
                lineNumber: index + 1,
                originalLine: line,
                partNumber,
                topDia: isNaN(topDia) ? null : topDia,
                bottomDia: isNaN(bottomDia) ? null : bottomDia,
                thickness: isNaN(parseFloat(thickStr)) ? null : parseFloat(thickStr),
                length: isNaN(parseFloat(lenStr)) ? null : parseFloat(lenStr)
            });
        }
    });
    return parsed;
};

export const analyzeDeductions = (content: string): DeductionCandidate[] => {
    const lines = content.split(/\r?\n/);
    const candidates: DeductionCandidate[] = [];
    
    lines.forEach((line, index) => {
        if (!line.trim()) return;
        
        const tokens = line.trim().split(/[\s,;\t]+/);
        if (tokens.length >= 7) {
            const col5 = tokens[4];
            if (col5 === 'FP' || col5 === 'B9' || col5 === 'S') {
                const col7 = tokens[6];
                if (/^[+-]?\d+\.\d+$/.test(col7)) {
                    const num = parseFloat(col7);
                    if (!isNaN(num)) {
                        candidates.push({
                            lineNumber: index + 1,
                            originalLine: line,
                            col5Value: col5,
                            col7Value: col7,
                            col7Number: num,
                            selected: true
                        });
                    }
                }
            }
        }
    });
    
    return candidates;
};

/**
 * Replaces tokens in a text file based on rounding logic.
 * Automatically identifies decimal measurements anywhere in the file (any column layout, CSV, space-delimited, etc.),
 * rounds them to the nearest 1/32, and rebuilds each line while dynamically preserving
 * exact whitespace, prefixes, and fixed-width column alignments.
 * @param content The full string content of the text file.
 * @param deductionLines Optional set of line numbers where 0.1875 should be subtracted from column 7 before rounding.
 * @returns The processed string content and a log of changes.
 */
export const processTextFile = (
    content: string,
    deductionLines: Set<number> = new Set()
): ProcessResult => {
    const lines = content.split(/\r?\n/);
    const changes: ProcessResult['changes'] = [];

    const processedLines = lines.map((line, index) => {
        // Skip empty lines to save processing time
        if (!line.trim()) {
            return line;
        }

        const lineNumber = index + 1;
        const applyDeductionToCol7 = deductionLines.has(lineNumber);

        let colIndex = 0;
        
        // This RegEx detects tokens separated by whitespace or common delimiters
        return line.replace(/(^|[\s,;\t]+)([^\s,;\t]+)/g, (match, prefix, token) => {
            colIndex++;
            
            // Only process valid decimal representations (e.g. 123.45, -12.34, +0.01)
            const numPartMatch = token.match(/^([+-]?\d+\.\d+)$/);
            if (!numPartMatch) {
                return match;
            }

            let num = parseFloat(token);
            if (isNaN(num)) return match;

            // Apply the custom deduction logic for column 7 if criteria was met
            if (applyDeductionToCol7 && colIndex === 7) {
                num -= 0.1875;
            }

            // Round the detected number
            const rounded = roundToNearest32nd(num);
            
            // Re-format to match original decimal places
            const decimalMatch = token.match(/\.(\d+)/);
            const decimals = decimalMatch ? decimalMatch[1].length : 0;
            let newNumStr = rounded.toFixed(decimals);
            
            // Re-apply original leading zeros and signs
            const intPartMatch = token.match(/^([+-]?)(0+)(\d+)\./);
            if (intPartMatch) {
                const originalSign = intPartMatch[1];
                const isNewNegative = rounded < 0 || Object.is(rounded, -0);
                
                let newAbsIntPart = Math.abs(Math.trunc(rounded)).toString();
                const originalAbsIntPart = intPartMatch[2] + intPartMatch[3];
                
                // Pad with zeros to match original structure (e.g., 001.5 stays 001.5 instead of 1.5)
                while (newAbsIntPart.length < originalAbsIntPart.length) {
                    newAbsIntPart = '0' + newAbsIntPart;
                }
                
                const signToUse = isNewNegative ? '-' : originalSign;
                const decimalPart = newNumStr.includes('.') ? '.' + newNumStr.split('.')[1] : '';
                newNumStr = signToUse + newAbsIntPart + decimalPart;
            } else if (token.startsWith('+') && !newNumStr.startsWith('-')) {
                // If it wasn't a padded zero number, just make sure '+' sign is re-applied if it existed
                newNumStr = '+' + newNumStr;
            }
            
            // Calculate width differences to inject or remove prefix spaces (keeps strict column alignments)
            const diff = newNumStr.length - token.length;
            let newPrefix = prefix;
            
            if (diff > 0) {
                for (let i = 0; i < diff; i++) {
                    if (newPrefix.endsWith(' ')) {
                        newPrefix = newPrefix.slice(0, -1);
                    }
                }
            } else if (diff < 0) {
                newPrefix = newPrefix + ' '.repeat(Math.abs(diff));
            }
            
            if (token !== newNumStr) {
                changes.push({
                    lineNumber,
                    original: token,
                    updated: newNumStr
                });
            }
            
            return newPrefix + newNumStr;
        });
    });

    return {
        processedContent: processedLines.join(content.includes('\r\n') ? '\r\n' : '\n'),
        changes
    };
};
