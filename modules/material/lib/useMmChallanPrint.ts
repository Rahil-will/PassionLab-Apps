import { useEffect, useRef, useState } from 'react';
import { challanPrintFileName, type MmChallanPrintDoc } from './mmChallanPrint';

const PRINT_BODY_CLASS = 'mm-print-challan';

export function useMmChallanPrint(
  doc: MmChallanPrintDoc | null,
  options?: {
    auto?: boolean;
    onAfterPrint?: () => void;
  },
) {
  const [printNow, setPrintNow] = useState(false);
  const afterPrint = useRef(options?.onAfterPrint);
  afterPrint.current = options?.onAfterPrint;
  const autoKey = useRef<string | null>(null);

  useEffect(() => {
    if (!options?.auto || !doc) return;
    const key = `${doc.kind}:${doc.challanNo}`;
    if (autoKey.current === key) return;
    autoKey.current = key;
    setPrintNow(true);
  }, [options?.auto, doc]);

  useEffect(() => {
    if (!printNow || !doc) return;
    const prevTitle = document.title;
    document.title = challanPrintFileName(doc);
    document.body.classList.add(PRINT_BODY_CLASS);
    const done = () => {
      document.title = prevTitle;
      document.body.classList.remove(PRINT_BODY_CLASS);
      setPrintNow(false);
      afterPrint.current?.();
    };
    const timer = window.setTimeout(() => window.print(), 120);
    window.addEventListener('afterprint', done);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      document.title = prevTitle;
      document.body.classList.remove(PRINT_BODY_CLASS);
    };
  }, [printNow, doc]);

  return {
    printing: printNow,
    requestPrint: () => {
      if (doc) setPrintNow(true);
    },
  };
}
