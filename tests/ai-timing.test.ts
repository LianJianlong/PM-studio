import {test} from 'node:test';import assert from 'node:assert/strict';import {aiTiming} from '../shared/ai-timing.ts';
test('local loading and inference budgets are separate, bounded, and cloud provider budgets stay unchanged',()=>{
 assert.deepEqual(aiTiming({provider:'ollama'}),{cold:1800,inference:600,turn:1800});assert.deepEqual(aiTiming({provider:'ollama',cold_start_seconds:99999,timeout_seconds:99999}),{cold:3600,inference:1800,turn:1800});assert.deepEqual(aiTiming({provider:'openai',timeout_seconds:60}),{cold:0,inference:60,turn:180});
});
