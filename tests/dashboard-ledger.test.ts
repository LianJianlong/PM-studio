import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ledgerPriority} from '../shared/dashboard-ledger.ts';
test('ledger highlights open high risks, failures and overdue items, without escalating completed items',()=>{const day='2026-10-19';assert.equal(ledgerPriority('safety',{risk_level:'高',closure_state:'整改中'},day),'紧急');assert.equal(ledgerPriority('quality',{result:'不通过'},day),'紧急');assert.equal(ledgerPriority('design',{planned_date:'2026-10-18',drawing_state:'待审'},day),'高');assert.equal(ledgerPriority('safety',{risk_level:'高',closure_state:'已关闭',due_date:'2026-01-01'},day),'已完成');assert.equal(ledgerPriority('procurement',{progress_state:'生产'},day),'普通');});
