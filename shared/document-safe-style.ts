// Same CSS allowlist for paste/open and persisted/printed documents. No URL-bearing styles.
export const safeDocumentStyles:Record<string,RegExp[]>={
 'text-align':[/^(left|center|right|justify)$/], 'font-size':[/^(?:[89]|[1-6][0-9]|7[0-2])(?:\.5)?(?:pt|px)$/], 'font-family':[/^[a-zA-Z\s,"-]+$/],
 color:[/^#[a-fA-F0-9]{3,8}$/, /^rgba?\([\d., %]+\)$/], 'background-color':[/^#[a-fA-F0-9]{3,8}$/, /^rgba?\([\d., %]+\)$/],width:[/^\d{1,4}(?:px|%)$/],
 'page-break-after':[/^always$/],'break-after':[/^page$/],'line-height':[/^(1|1\.15|1\.5|1\.7|2|2\.5|3)$/],'text-indent':[/^2em$/],
 'margin-left':[/^(auto|0|[0-9]{1,2}em)$/],'margin-right':[/^(auto|0)$/],'margin-top':[/^[0-9]{1,2}pt$/],'margin-bottom':[/^[0-9]{1,2}pt$/],display:[/^block$/],border:[/^1px solid (#[a-fA-F0-9]{6}|rgba?\([\d., %]+\))$/],padding:[/^8px$/]
};
export function safeDocumentCss(property:string,value:string){return !!safeDocumentStyles[property]?.some(rule=>rule.test(value))}
