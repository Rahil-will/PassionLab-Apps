import React from 'react';
import type { MmV4CustodySide, MmV4QcSiteSide } from '../lib/mmV4Rpc';
import MmTestingDocsPage from './warehouse/MmTestingDocsPage';

export default function MmQcQueuePage({
  side: _side,
  siteSide: _siteSide,
}: {
  side: MmV4CustodySide;
  siteSide: MmV4QcSiteSide;
}) {
  return <MmTestingDocsPage mode="queue" />;
}
