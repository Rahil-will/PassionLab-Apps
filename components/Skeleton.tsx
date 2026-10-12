import React from 'react';

interface SkeletonProps {
    className?: string;
    variant?: 'text' | 'circular' | 'rectangular';
    width?: string | number;
    height?: string | number;
    animation?: 'pulse' | 'wave' | 'none';
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
    className = '', 
    variant = 'text',
    width,
    height,
    animation = 'pulse'
}) => {
    const baseClasses = 'bg-slate-200';
    const animationClasses = animation === 'pulse' 
        ? 'animate-pulse' 
        : animation === 'wave' 
        ? 'animate-shimmer' 
        : '';
    
    const variantClasses = {
        text: 'rounded h-4',
        circular: 'rounded-full',
        rectangular: 'rounded-lg'
    };

    const style: React.CSSProperties = {};
    if (width) style.width = typeof width === 'number' ? `${width}px` : width;
    if (height) style.height = typeof height === 'number' ? `${height}px` : height;

    return (
        <div 
            className={`${baseClasses} ${variantClasses[variant]} ${animationClasses} ${className}`}
            style={style}
        />
    );
};

interface TableSkeletonProps {
    rows?: number;
    columns?: number;
    showHeader?: boolean;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({ 
    rows = 5, 
    columns = 6,
    showHeader = true 
}) => {
    return (
        <div className="w-full">
            {showHeader && (
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex gap-4">
                    {Array.from({ length: columns }).map((_, i) => (
                        <Skeleton key={i} className="h-4 flex-1" />
                    ))}
                </div>
            )}
            <div className="divide-y divide-slate-100">
                {Array.from({ length: rows }).map((_, rowIdx) => (
                    <div key={rowIdx} className="px-6 py-3 flex gap-4 items-center">
                        {Array.from({ length: columns }).map((_, colIdx) => (
                            <Skeleton 
                                key={colIdx} 
                                className="h-4 flex-1" 
                                width={colIdx === 0 ? '60%' : '100%'}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

interface CardSkeletonProps {
    count?: number;
    showImage?: boolean;
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({ 
    count = 1,
    showImage = false 
}) => {
    return (
        <>
            {Array.from({ length: count }).map((_, idx) => (
                <div key={idx} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    {showImage && (
                        <Skeleton variant="rectangular" className="w-full h-48 mb-4" />
                    )}
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <div className="flex gap-2 pt-2">
                        <Skeleton variant="rectangular" className="h-8 w-20" />
                        <Skeleton variant="rectangular" className="h-8 w-20" />
                    </div>
                </div>
            ))}
        </>
    );
};

interface ListSkeletonProps {
    rows?: number;
    showAvatar?: boolean;
}

export const ListSkeleton: React.FC<ListSkeletonProps> = ({ 
    rows = 5,
    showAvatar = false 
}) => {
    return (
        <div className="space-y-3">
            {Array.from({ length: rows }).map((_, idx) => (
                <div key={idx} className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-lg">
                    {showAvatar && (
                        <Skeleton variant="circular" width={40} height={40} />
                    )}
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-1/3" />
                        <Skeleton className="h-4 w-2/3" />
                    </div>
                </div>
            ))}
        </div>
    );
};

interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ 
    size = 'md',
    className = '' 
}) => {
    const sizeClasses = {
        sm: 'w-4 h-4 border-2',
        md: 'w-8 h-8 border-2',
        lg: 'w-12 h-12 border-3'
    };

    return (
        <div 
            className={`${sizeClasses[size]} border-blue-200 border-t-blue-600 rounded-full animate-spin ${className}`}
        />
    );
};

interface LoadingOverlayProps {
    message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ 
    message = 'Loading...' 
}) => {
    return (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-8 flex flex-col items-center gap-4">
                <Spinner size="lg" />
                <p className="text-[10px] text-slate-600 font-medium">{message}</p>
            </div>
        </div>
    );
};
