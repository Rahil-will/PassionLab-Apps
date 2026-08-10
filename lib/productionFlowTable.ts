/** Shared column classes for Colors + Production Matrix tables */
export const flowTableClasses = {
    wrapper: 'border border-slate-200 rounded-lg overflow-hidden',
    scroll: 'overflow-x-auto relative after:content-[""] after:absolute after:top-0 after:right-0 after:bottom-0 after:w-8 after:bg-gradient-to-l after:from-slate-200/40 after:to-transparent after:pointer-events-none',
    table: 'w-full text-[10px] text-left border-collapse',
    thead: 'bg-slate-50 text-[9px] uppercase font-semibold text-slate-500',
    firstHead:
        'px-4 py-3 w-46 text-left border-b-2 border-slate-200 border-r border-slate-200 bg-slate-100 sticky left-0 z-10',
    numHead:
        'px-3 py-3 text-center min-w-[68px] border-b-2 border-slate-200 border-r border-slate-100 text-slate-400',
    adjHead:
        'px-3 py-3 text-center min-w-[68px] border-b-2 border-slate-200 border-r border-slate-200 text-blue-600',
    deptHead:
        'px-3 py-3 text-center min-w-[72px] border-b-2 border-slate-200 border-r border-slate-100 text-slate-700',
    statusHead:
        'px-3 py-3 text-center min-w-[72px] border-b-2 border-slate-200 border-r border-slate-100',
    firstCell:
        'px-4 py-2.5 border-r border-slate-200 bg-slate-50 sticky left-0 z-10',
    numCell: 'px-3 py-2 text-center font-bold text-[10px] text-slate-700 border-r border-slate-100',
    adjCell:
        'px-3 py-2 text-center font-bold text-[10px] text-blue-700 bg-blue-50/10 border-r border-slate-200',
    deptCell: 'px-3 py-2 text-center text-[10px] text-slate-600 border-r border-slate-100',
    statusCell: 'px-3 py-2 text-center text-[10px] font-medium border-r border-slate-100',
    footFirst:
        'py-3 px-4 text-left border-r border-slate-200 uppercase text-[10px] sticky left-0 z-10 bg-slate-100',
    footNum: 'py-2 px-3 text-center border-r border-slate-100 text-[10px]',
    footAdj: 'py-2 px-3 text-center border-r border-slate-200 text-blue-700 text-[10px]',
    footDept: 'py-2 px-3 text-center border-r border-slate-100 text-[10px] text-slate-700',
    footStatus: 'py-2 px-3 text-center border-r border-slate-100 text-[10px]',
} as const;
