import {test} from 'node:test';import assert from 'node:assert/strict';
import {reviewMode,editableRecord} from '../shared/record-policy.ts';
import {rowAllowed,canConfirmRecord,recordVisibilitySql} from '../server/auth.ts';
test('routine ledgers use supervisor confirmation while major transactions use approvals',()=>{
 for(const name of ['施工日报','采购动态','库存台账','出入库记录','隐患台账','WBS'])assert.equal(reviewMode({name}),'supervisor');
 for(const name of ['人员分工表','采购申请','采购订单','领料单','付款申请','设计变更申请'])assert.equal(reviewMode({name}),'approval');
 assert(editableRecord({review_mode:'supervisor'},'approved'));assert(!editableRecord({review_mode:'approval'},'approved'));assert(!editableRecord({review_mode:'supervisor'},'pending'));
});
test('drafts are restricted to author/editor, scoped supervisor and project administrators',()=>{
 const viewer={role:'viewer',row_scope:'all'};const draft={table_id:'table',status:'draft',created_by:'author',updated_by:'editor'};
 assert(!rowAllowed(viewer,draft,'other'));assert(rowAllowed(viewer,draft,'author'));assert(rowAllowed(viewer,draft,'editor'));assert(rowAllowed(viewer,{...draft,status:'approved'},'other'));
 assert(!rowAllowed({...viewer,role:'reviewer',confirmation_table_ids:['different']},draft,'other'));
 assert(rowAllowed({...viewer,role:'reviewer',confirmation_table_ids:['table']},draft,'other'));
 const table={id:'table',department_id:'department',columns:[{id:'name'}],lifecycle:'active'};
 assert(canConfirmRecord({role:'reviewer',confirmation_table_ids:['table'],table_ids:[],hidden_columns:[],row_scope:'all'},table));
 assert(!canConfirmRecord({role:'editor',confirmation_table_ids:[],table_ids:[],hidden_columns:[],row_scope:'all'},table));
 assert(!canConfirmRecord({role:'reviewer',confirmation_table_ids:['table'],table_ids:[],hidden_columns:['name'],row_scope:'all'},table));
 assert(recordVisibilitySql({role:'owner'},'$2').includes('$2::uuid'));
});
