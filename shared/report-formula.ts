/** Bounded arithmetic parser. No JavaScript execution or property access. */
type Node={value?:number;name?:string;op?:string;args?:Node[]};
export function parseReportFormula(source:string):Node{
 if(!source||source.length>1000)throw Error('公式长度须为1至1000字符');
 const tokens=source.toUpperCase().match(/(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|[A-Z_]+|>=|<=|<>|!=|==|[+\-*/%^(),=<>]/g)||[];
 if(tokens.join('')!==source.toUpperCase().replace(/\s/g,'')||tokens.length>256)throw Error('公式含不支持的字符或过长');
 let at=0;const priority:Record<string,number>={'=':1,'==':1,'!=':1,'<>':1,'>':1,'<':1,'>=':1,'<=':1,'+':2,'-':2,'*':3,'/':3,'%':3,'^':4};
 function expr(min=0,depth=0):Node{
  if(depth>32)throw Error('公式嵌套超过32层');let node:Node,t=tokens[at++];
  if(t==='+'||t==='-')node={op:'u'+t,args:[expr(4,depth+1)]};
  else if(t==='('){node=expr(0,depth+1);if(tokens[at++]!==')')throw Error('公式括号不匹配')}
  else if(t&&/^\d|^\./.test(t))node={value:Number(t)};
  else if(t&&/^[A-Z_]+$/.test(t)){
   if(tokens[at]==='('){at++;const args:Node[]=[];if(tokens[at]!==')')do{args.push(expr(0,depth+1));if(tokens[at]!==',')break;at++}while(true);if(tokens[at++]!==')')throw Error('函数括号不匹配');if(!['SUM','AVG','AVERAGE','MIN','MAX','COUNT','IF','ROUND','ABS','CEIL','FLOOR','SQRT','POWER','AND','OR','NOT'].includes(t))throw Error('不支持函数：'+t);node={name:t,args};}
   else{if(!['VALUE','TOTAL','COUNT','VALUES','TRUE','FALSE'].includes(t))throw Error('未知变量：'+t);node={name:t}}
  }else throw Error('公式缺少操作数');
  while(at<tokens.length&&(priority[tokens[at]]??-1)>=min){const op=tokens[at++],p=priority[op];node={op,args:[node,expr(p+(op==='^'?0:1),depth+1)]}}
  return node;
 }
 const ast=expr();if(at!==tokens.length)throw Error('公式语法错误');return ast;
}
export function evaluateReportFormula(source:string,context:{value:number;total:number;count:number;values:number[]}):number{
 const ast=parseReportFormula(source);
 function number(v:number|number[]):number{if(Array.isArray(v))throw Error('请用聚合函数计算VALUES');if(!Number.isFinite(v))throw Error('公式结果无效（除零或数值溢出）');return v}
 function evaluate(n:Node):number|number[]{
  if(n.value!==undefined)return number(n.value);
  if(n.op){const a=number(evaluate(n.args![0]));if(n.op==='u-')return -a;if(n.op==='u+')return a;const b=number(evaluate(n.args![1]));return number(n.op==='+'?a+b:n.op==='-'?a-b:n.op==='*'?a*b:n.op==='/'?a/b:n.op==='%'?a%b:n.op==='^'?a**b:n.op==='>'?+(a>b):n.op==='<'?+(a<b):n.op==='>='?+(a>=b):n.op==='<='?+(a<=b):['!=','<>'].includes(n.op)?+(a!==b):+(a===b))}
  const name=n.name!;if(!n.args)return name==='VALUES'?context.values:name==='VALUE'?context.value:name==='TOTAL'?context.total:name==='COUNT'?context.count:name==='TRUE'?1:0;
  if(name==='IF'){if(n.args.length!==3)throw Error('IF需要3个参数');return evaluate(n.args[number(evaluate(n.args[0]))?1:2])}
  const args=n.args.map(evaluate).flat();if(args.some(v=>!Number.isFinite(v)))throw Error('公式数据无效');
  if(['ROUND','POWER'].includes(name)&&args.length!==2||['ABS','CEIL','FLOOR','SQRT','NOT'].includes(name)&&args.length!==1)throw Error('函数参数数量错误');
  const sum=args.reduce((a,b)=>a+b,0);return number(name==='COUNT'?args.length:name==='SUM'?sum:['AVG','AVERAGE'].includes(name)?sum/args.length:name==='MIN'?Math.min(...args):name==='MAX'?Math.max(...args):name==='ROUND'?Math.round(args[0]*10**args[1])/10**args[1]:name==='ABS'?Math.abs(args[0]):name==='CEIL'?Math.ceil(args[0]):name==='FLOOR'?Math.floor(args[0]):name==='SQRT'?Math.sqrt(args[0]):name==='POWER'?args[0]**args[1]:name==='AND'?+args.every(Boolean):name==='OR'?+args.some(Boolean):+!args[0]);
 }
 return number(evaluate(ast));
}
export function formulaSeries<T extends {rows:{label:string;value:string|number}[];overall?:string|number;groupCount?:number}>(data:T,formula?:string):T{
 if(!formula)return data;const values=data.rows.map(r=>Number(r.value)),total=Number(data.overall??values.reduce((a,b)=>a+b,0)),count=data.groupCount??values.length;
 return {...data,rows:data.rows.map(r=>({...r,value:evaluateReportFormula(formula,{value:Number(r.value),total,count,values})})),overall:evaluateReportFormula(formula,{value:total,total,count,values})};
}
