import React from 'react';

interface MaterialComponentMappingProps {
  factoryId: string | null | undefined;
}

/** Order-detail mapping is not part of the current Material config surface. */
export const MaterialComponentMapping: React.FC<MaterialComponentMappingProps> = () => null;
