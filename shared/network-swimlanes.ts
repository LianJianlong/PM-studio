import {z} from 'zod';
export const networkSwimlanes=z.array(z.object({id:z.string().min(1).max(100),name:z.string().trim().min(1).max(120),height:z.number().int().min(86).max(1720).default(258)}).strict()).max(100).default([]).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'Duplicate swimlane IDs');
export type NetworkSwimlane=z.infer<typeof networkSwimlanes>[number];
export function swimlaneBands(rows:NetworkSwimlane[]){let top=70;return rows.map((row,index)=>{const band={...row,index,top,bottom:top+row.height};top=band.bottom;return band})}
