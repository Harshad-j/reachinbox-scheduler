import Papa from "papaparse";
export type RecipientParseResult={recipients:string[];invalidCount:number};
const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function parseRecipientCells(cells:string[]):RecipientParseResult{const unique=new Set<string>();let invalidCount=0;for(const cell of cells.flatMap(value=>value.split(/[\s,;]+/)).map(value=>value.trim()).filter(Boolean)){if(!validEmail.test(cell)||unique.has(cell.toLowerCase())){invalidCount++;continue}unique.add(cell.toLowerCase())}return{recipients:[...unique],invalidCount}}
export async function parseRecipientFile(file:File):Promise<RecipientParseResult>{return new Promise((resolve,reject)=>Papa.parse<string[]>(file,{complete:result=>resolve(parseRecipientCells(result.data.flat())),error:reject,skipEmptyLines:true}))}
