import { z } from 'zod';

const schema = z.object({
  id: z.string(),
  num: z.number().optional(),
  nested: z.object({
    foo: z.boolean()
  }).optional()
});

console.log(Object.keys(schema.shape));
console.log(schema.shape.num instanceof z.ZodOptional);
console.log(schema.shape.num._def.innerType instanceof z.ZodNumber);

const optionalNested = schema.shape.nested as z.ZodOptional<z.ZodObject<any>>;
console.log(optionalNested._def.innerType instanceof z.ZodObject);
console.log(Object.keys(optionalNested._def.innerType.shape));
