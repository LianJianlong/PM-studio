export const LOCAL_COLD_START_SECONDS=1800;
export const MAX_LOCAL_COLD_START_SECONDS=3600;
export const LOCAL_INFERENCE_SECONDS=600;
export const MAX_LOCAL_INFERENCE_SECONDS=1800;
export function aiTiming(config:{provider:string;cold_start_seconds?:number;timeout_seconds?:number}){
 const local=config.provider==='ollama';
 return {cold:local?Math.min(3600,Math.max(5,config.cold_start_seconds??1800)):0,inference:Math.min(local?1800:120,Math.max(5,config.timeout_seconds??(local?600:60))),turn:local?1800:180};
}
