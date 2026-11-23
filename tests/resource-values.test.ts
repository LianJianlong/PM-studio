import { test } from "node:test";
import assert from "node:assert/strict";
import { resourceValue, resourceTicks, resourceText, distributeResource, resourceCost, resourceUnits, distributeResourceByMinutes, calendarCapacity } from "../shared/resource-values.ts";
test("resources retain large decimal values and reject rounding, negatives and unsafe number inputs", () => {
  assert.equal(resourceValue("123456789012345.6789"), "123456789012345.6789");
  assert.equal(resourceValue(0.1234), "0.1234");
  assert.throws(() => resourceValue("0.12345"));
  assert.throws(() => resourceValue(-1));
  assert.throws(() => resourceValue(123456789012345.67));
  assert.throws(() => resourceValue("1000000000000000.0001"));
});
test('resource shares follow work hours and conserve quantity and costs with large exact values',()=>{
 assert.deepEqual(distributeResourceByMinutes('12.0000',[240,480]).map(resourceText),['4.0000','8.0000']);
 for(const value of ['0.0001','0.1000','123456789012345.6789']) {
  const shares=distributeResourceByMinutes(value,[30,240,480]);
  assert.equal(shares.reduce((s,v)=>s+v,0n),resourceTicks(value));
 }
 assert.equal(resourceCost('3.0000','12.3456'),'37.0368');
 assert.equal(resourceCost('0.0001','0.5000'),'0.0001');
 assert.equal(resourceText(calendarCapacity('10.0000',240,8)),'5.0000');
 assert.equal(resourceText(calendarCapacity('10.0000',0,8)),'0.0000');
 assert.throws(()=>distributeResourceByMinutes('1.0000',[0]));
});
test("daily resource shares retain four decimals and conserve total including remainder", () => {
  for (const value of ["0.1000", "0.0001", "123456789012345.6789"]) {
    const shares = distributeResource(value, 3);
    assert.equal(shares.reduce((sum, item) => sum + item, 0n), resourceTicks(value));
    assert.ok(shares.every((item) => /^\d+\.\d{4}$/.test(resourceText(item))));
  }
  assert.deepEqual(distributeResource("0.1000", 3).map(resourceText), ["0.0334", "0.0333", "0.0333"]);
});

test('planned resource cost multiplies rate, assigned quantity and working duration with one exact rounding',()=>{
 assert.equal(resourceCost('3.0000','100.0000','5.0000'),'1500.0000');
 assert.equal(resourceCost('3.0000','100.0000','10.0000'),'3000.0000');
 assert.equal(resourceCost('3.0000','100.0000','0.0000'),'0.0000');
 assert.equal(resourceCost('0.0001','0.5000','0.5000'),'0.0000');
 assert.equal(resourceCost('2.5000','12.3456','1.5000'),'46.2960');
 assert.throws(()=>resourceCost('1000000000000','1000000000000','3650'));
});

test('daily assignment work units multiply duration without an unrelated monetary cap',()=>{
 assert.equal(resourceUnits('3.0000','5'),'15.0000');
 assert.equal(resourceUnits('1000000000000.0000','3650'),'3650000000000000.0000');
});
