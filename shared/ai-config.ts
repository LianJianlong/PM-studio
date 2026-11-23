export function normalizeGeminiModel(value:string){const model=value.trim().replace(/^models\//i,'');return /^gemini(?:\s|[-])/i.test(model)?model.toLowerCase().replace(/\s+/g,'-'):model;}
export function resolveAIConfigKey(previous:string|undefined,input:string|undefined,clear:boolean|undefined,enabled:boolean,local:boolean){
 const replacement=(input||'').trim();
 // A supplied replacement takes precedence over an obsolete clear flag.
 const key=replacement||(clear?'':previous||'');
 return {key,enabled:clear&&!replacement&&!local?false:enabled};
}
