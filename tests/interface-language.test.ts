import test from 'node:test';
import assert from 'node:assert/strict';
import {setInterfaceLanguage,translateUiText,translateUiValue,interfaceLocale} from '../src/i18n.ts';
import dictionary from '../src/locales/en.json';
test('interface language switches both ways without changing source values',()=>{
 setInterfaceLanguage('en');assert.equal(translateUiText('用户管理'),'User management');assert.equal(translateUiText('分配项目角色'),'Assign project role');assert.equal(interfaceLocale(),'en-GB');
 const value={name:'用户管理'};assert.equal(translateUiValue(value),value);assert.equal(value.name,'用户管理');
 setInterfaceLanguage('zh-CN');assert.equal(translateUiText('用户管理'),'用户管理');assert.equal(interfaceLocale(),'zh-CN');
});
test('localized system templates preserve inserted business names and counts',()=>{
 setInterfaceLanguage('en');
 const source='已保存3名成员的权限';const result=translateUiText(source);assert.match(result,/3/);assert.doesNotMatch(result,/[\u3400-\u9fff]/);
 assert.equal(translateUiText('客户自定义的火星勘探项目ZK-23'),'客户自定义的火星勘探项目ZK-23');
 const dynamic='确定删除报表“客户的季度数据”？';assert.match(translateUiText(dynamic),/客户的季度数据/);
 setInterfaceLanguage('zh-CN');
});
test('every extracted system message has an English translation and placeholders are preserved',()=>{
 for(const [source,target] of Object.entries(dictionary)){
  if(source==='简体中文')continue;
  assert.doesNotMatch(target,/[\u3400-\u9fff]/,source);
  const parameters=[...source.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();
  const translated=[...target.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();
  assert.deepEqual(translated,parameters,source);
 }
});
