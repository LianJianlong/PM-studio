export const accountNames:string[];
type Account={username:string;password_hash:string};
export function rotateCredentials(options:{file:string;newJob?:boolean;protect?:(directory:string)=>void|Promise<void>;driver:{read:()=>Account[]|Promise<Account[]>;apply:(values:{username:string;hash:string;previous:string}[])=>void|Promise<void>}}):Promise<{state:string;count:number}>;
