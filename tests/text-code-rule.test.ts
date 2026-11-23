import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {field,validateRecord} from '../server/validation.ts';

test('composite code settings are valid for text fields and reject invalid rules',()=>{
  const rule={id:'code',name:'编码',type:'text',required:true,auto_code:true,code_prefix:'WBS-',code_start:'100',code_step:'10',code_width:4,code_fill_gaps:true};
  assert.equal(field.safeParse(rule).success,true);
  assert.equal(field.safeParse({...rule,type:'int32'}).success,false);
  assert.equal(field.safeParse({...rule,code_prefix:'bad prefix'}).success,false);
});

test('required composite code accepts blank input for server allocation and custom text',()=>{
  const columns=[{id:'code',name:'编码',type:'text',required:true,auto_code:true}];
  assert.equal(validateRecord(columns,{code:''}).code,null);
  assert.equal(validateRecord(columns,{code:'WBS-001A'}).code,'WBS-001A');
});
