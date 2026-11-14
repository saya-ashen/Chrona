export function submittedReceipts(conversation: any) {
  const receipts = [...(conversation.deliveries ?? [])];
  for (const m of [...conversation.messages, ...(conversation.active ? [{ run: conversation.active }] : [])]) {
    for (const item of m.run?.transcript ?? []) {
      if (item.kind !== 'result' || item.error || !/^(?:m_)?(?:author|modules)[._:-]submit$/.test(item.tool)) continue;
      try {
        const raw = JSON.parse(item.text), r = raw.result ?? raw;
        if (typeof r.receiptId !== 'string' || typeof r.requestKey !== 'string' || !Array.isArray(r.members) || !r.members.length || !r.members.every((x: any) => typeof x.moduleId === 'string' && /^[a-f0-9]{40,64}$/.test(x.hash))) continue;
        if (!receipts.some(x => x.receiptId === r.receiptId)) receipts.push({ receiptId: r.receiptId, original: r, state: '候选已提交，等待核对' });
      } catch (e: any) {
        console.error(JSON.stringify({ component: 'chat', event: 'incomplete-receipt', tool: item.tool, error: e.message }));
      }
    }
  }
  return receipts;
}
