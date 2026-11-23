import {test} from 'node:test';import assert from 'node:assert/strict';import {formatDocumentAIResult} from '../server/ai-document-format.ts';
const id='00000000-0000-4000-8000-000000000001';
test('AI writing unwraps HTML fences and converts Markdown around genuine HTML blocks',()=>{
 const html=formatDocumentAIResult('```html\n<h2>Report</h2>\n<p>120.30</p>\n```\n\n**Next step:** verify delivery');assert(html.includes('<h2>Report</h2>'));assert(html.includes('<strong>Next step:</strong>'));assert(html.includes('120.30'));assert(!html.includes('```'));
});
test('document IDs are replaced only in visible text; links survive and labels cannot inject HTML',()=>{
 const html=formatDocumentAIResult(`<p>Order (ID: ${id}) ${id}</p><a href="https://example.com/${id}">Source</a>`,{[id]:'<img src=x onerror=alert(1)>'});assert(!html.includes('(ID:'));assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('https://example.com/'+id));
});
test('thoughts, scripts and unsafe HTML cannot become the adopted draft',()=>{
 const html=formatDocumentAIResult('<think>private reasoning</think><p>Result</p><script>alert(1)</script>');assert(!html.includes('reasoning'));assert(!html.includes('alert'));assert(html.includes('Result'));
});
