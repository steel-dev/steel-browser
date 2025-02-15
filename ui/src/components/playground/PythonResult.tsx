interface PythonResultProps {
    result?: string;
    error?: string;
    exitCode?: number;
    isError: boolean;
}

export function PythonResult({ result, error, exitCode, isError }: PythonResultProps) {
    // Show default state before any execution
    if (exitCode === undefined) {
        return (
            <div className="p-4 rounded-lg overflow-hidden bg-[var(--gray-3)] border border-gray-300 dark:border-gray-600 max-h-[23vh] flex flex-col">
                <div className="flex-1 flex items-center justify-center text-gray-500 italic">
                    Run Python code to see the output here.
                </div>
            </div>
        );
    }

    return (
        <div className={`p-3 rounded-lg overflow-hidden ${exitCode === 0
            ? 'bg-green-100 dark:bg-[var(--gray-3)] border border-green-400 dark:border-gray-600'
            : 'bg-red-100 dark:bg-[var(--gray-3)] border border-red-400 dark:border-gray-600'
            } max-h-[22vh] flex flex-col`}
        >
            <div className="flex justify-between items-center mb-2 shrink-0">
                <span className={`font-semibold ${exitCode === 0
                    ? 'text-green-500'
                    : 'text-red-500'
                    }`}>
                    {exitCode === 0 ? '✅ Execution Successful' : '❌ Execution Failed'}
                </span>
                <span className={`text-sm px-2 py-1 rounded ${exitCode === 0
                    ? 'bg-green-200 text-green-800'
                    : 'bg-red-200 text-red-800'
                    }`}>
                    Exit Code: {exitCode ?? 'N/A'}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
                {result && (
                    <pre className="whitespace-pre-wrap text-sm p-3 rounded bg-white/80 backdrop-blur-sm overflow-x-auto text-green-900">
                        {result}
                    </pre>
                )}

                {error && (
                    <pre className="whitespace-pre-wrap text-sm p-3 rounded bg-white/80 backdrop-blur-sm overflow-x-auto text-red-900">
                        {error}
                    </pre>
                )}

                {isError && (
                    <div className="text-red-800">
                        An error occurred during execution.
                    </div>
                )}
            </div>
        </div>
    );
}