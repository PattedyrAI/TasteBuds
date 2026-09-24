import {z} from 'zod';
export const placeIdSchema=z.string().min(1).max(300).regex(/^[A-Za-z0-9_-]+$/);
