import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storageTargetBody,storageTargetEdit,workspaceStorageSelection} from '../shared/storage-target.ts';
const body={name:'Reserved',host:'db.example.invalid',database:'studio',user:'studio_runtime'};
test('storage interface validates metadata without resolving or connecting a host',()=>{
 assert.equal(storageTargetBody.parse(body).port,5432);assert.equal(storageTargetBody.parse({...body,host:'localhost'}).host,'localhost');
 assert.equal(storageTargetBody.parse({...body,engine:'mysql',schema:'engineering'}).engine,'mysql');
 for(const value of [{...body,host:'https://example.invalid'},{...body,engine:'sqlite'},{...body,port:1.5},{...body,state:'active'}])assert.equal(storageTargetBody.safeParse(value).success,false);
});
test('storage edits require versions and distinguish preserving password from replacing it',()=>{
 assert.equal(storageTargetEdit.safeParse(body).success,false);assert.equal(storageTargetEdit.parse({...body,version:1}).password,undefined);assert.equal(storageTargetEdit.parse({...body,version:1,password:''}).password,'');
 assert.equal(workspaceStorageSelection.parse(null),null);assert.equal(workspaceStorageSelection.safeParse('unknown').success,false);
});
