// Bound in-flight requests from a single browser tab, including response parsing.
export function createRequestQueue(limit=4) {
  let active=0;
  const waiting:Array<()=>void>=[];
  return async function queued<T>(run:()=>Promise<T>):Promise<T>{
    await new Promise<void>(resolve=>{const start=()=>{active++;resolve();};if(active<limit)start();else waiting.push(start);});
    try{return await run();}finally{active--;waiting.shift()?.();}
  };
}
