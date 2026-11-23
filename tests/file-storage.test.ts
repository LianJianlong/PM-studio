import {test} from 'node:test';import assert from 'node:assert/strict';import {normalizeStorageLink,MAX_FILE_BYTES} from '../shared/file-storage.ts';
test('storage links support web libraries, SMB and UNC without executable URLs or credentials',()=>{
 assert.equal(MAX_FILE_BYTES,5242880);assert.equal(normalizeStorageLink('https://files.example.com/project drawing/'),'https://files.example.com/project%20drawing/');assert.equal(normalizeStorageLink('\\\\nas\\工程\\图纸'),'smb://nas/%E5%B7%A5%E7%A8%8B/%E5%9B%BE%E7%BA%B8');assert.equal(normalizeStorageLink('smb://nas/share/'),'smb://nas/share/');for(const value of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','https://user:secret@nas/share','https://nas/\npath','/etc/passwd'])assert.throws(()=>normalizeStorageLink(value));
});
