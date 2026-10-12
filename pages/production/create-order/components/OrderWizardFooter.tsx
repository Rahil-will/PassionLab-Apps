import React from 'react';
import { Card } from '../../../../components/ui';
import { OrderWizardRail } from './OrderWizardRail';
import type { OrderWizardStage } from '../orderWizardStages';

interface OrderWizardFooterProps {
  stage: OrderWizardStage;
  completed: ReadonlySet<OrderWizardStage>;
  onSelectStage: (stage: OrderWizardStage) => void;
  onBack?: () => void;
  onDiscard?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
  gateNext?: boolean;
  summaryTitle?: string;
  summarySubtitle?: string;
  summaryAction?: React.ReactNode;
  children: React.ReactNode;
}

/** ~70% summary | ~30% named stage rail. */
export const OrderWizardFooter: React.FC<OrderWizardFooterProps> = ({
  stage,
  completed,
  onSelectStage,
  onBack,
  onDiscard,
  onNext,
  nextLabel,
  nextDisabled,
  showBack,
  gateNext,
  summaryTitle = 'Order Summary',
  summarySubtitle,
  summaryAction,
  children,
}) => (
  <div className="col-span-12 grid grid-cols-12 gap-4 items-stretch">
    <div className="col-span-12 lg:col-span-8 xl:col-span-9 min-w-0">
      <Card
        title={summaryTitle}
        subtitle={summarySubtitle}
        action={summaryAction}
        className="shadow-sm border-slate-200 h-full"
      >
        {children}
      </Card>
    </div>
    <div className="col-span-12 lg:col-span-4 xl:col-span-3 min-w-0">
      <div className="h-full rounded-xl border border-slate-200 bg-white shadow-sm p-3">
        <OrderWizardRail
          stage={stage}
          completed={completed}
          onSelect={onSelectStage}
          onBack={onBack}
          onDiscard={onDiscard}
          onNext={onNext}
          nextLabel={nextLabel}
          nextDisabled={nextDisabled}
          showBack={showBack}
          gateNext={gateNext}
        />
      </div>
    </div>
  </div>
);
