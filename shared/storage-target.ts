import {z} from 'zod';
export const storageTargetBody=z.object({
 name:z.string().trim().min(1).max(120),
 engine:z.enum(['postgres','mysql']).default('postgres'),
 host:z.string().trim().min(1).max(250).regex(/^[a-zA-Z0-9.:_-]+$/),
 port:z.number().int().min(1).max(65535).default(5432),
 database:z.string().trim().min(1).max(128),
 schema:z.string().trim().max(128).default('public'),
 user:z.string().trim().min(1).max(128),
 password:z.string().max(500).optional(),
 tls:z.boolean().default(true),
}).strict();
export const storageTargetEdit=storageTargetBody.extend({version:z.number().int().positive()});
export const workspaceStorageSelection=z.string().uuid().nullable().optional();
export const databaseProbeBody=storageTargetBody.extend({target_id:z.string().uuid().optional(),version:z.number().int().positive().optional()});
