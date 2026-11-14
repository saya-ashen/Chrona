import { expect, test } from 'bun:test';
import { admissionPrompt, ADMISSION_PROMPT_BYTES } from './core-admission-prompt';

test('the complete semantic verifier request is bounded in UTF-8 without truncating its evidence', () => {
  const data={requestId:'candidate',input:{value:'中'.repeat(3200)},evidence:[{text:'甲'.repeat(4000)},{text:'乙'.repeat(4000)}]};
  expect(Buffer.byteLength(JSON.stringify(data.input))).toBeLessThan(24000);
  expect(Buffer.byteLength(JSON.stringify({evidence:data.evidence}))).toBeLessThan(30000);
  expect(()=>admissionPrompt(data)).toThrow('prompt exceeds bound');
  const short={...data,evidence:[{text:'实际用户完整原文'}]};
  const prompt=admissionPrompt(short);
  expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(ADMISSION_PROMPT_BYTES);
  expect(prompt).toContain(JSON.stringify(short));
  expect(prompt).toContain('MUST INVOKE');
  expect(prompt).toContain('m_mind_admission_verdict');
  expect(prompt).toContain('NOT a tool invocation');
});
