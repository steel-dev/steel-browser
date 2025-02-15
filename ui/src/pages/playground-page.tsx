import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LanguageSelector } from '../components/playground/LanguageSelector';
import { CodeEditor } from '../components/playground/CodeEditor';
import { TerminalComponent } from '../components/playground/TerminalComponent';
import { PythonResult } from '../components/playground/PythonResult';
import { useWebContainer } from '@/hooks/use-web-container';
import { useFileSync } from '@/hooks/use-file-sync';
import { INITIAL_FILES } from '../utils/constants';
import { Language } from '@/types/language';
import { editor } from 'monaco-editor';
import { env } from '@/env';
import { useSessionsContext } from '@/hooks/use-sessions-context';
import { PlayIcon } from '@radix-ui/react-icons';
import SessionLogs from '@/components/sessions/session-console/session-logs';

interface PythonExecutionResult {
    result: string;
    error: string;
    exitCode: number;
}

export function PlaygroundPage() {
    const { useSession } = useSessionsContext();
    const { data: session } = useSession("");

    const [selectedLanguage, setSelectedLanguage] = useState<Language>(Language.TypeScript);
    const [codeContent, setCodeContent] = useState({
        python: INITIAL_FILES['main.py'].file.contents,
        typescript: INITIAL_FILES['index.ts'].file.contents
    });

    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const terminalContainerRef = useRef<HTMLDivElement>(null);

    const { webContainer, shellProcess } = useWebContainer(INITIAL_FILES);
    const currentFilePath = selectedLanguage === Language.TypeScript ? '/index.ts' : '/main.py';

    const runPythonMutation = useMutation<PythonExecutionResult, Error, string>({
        mutationFn: async (codeToRun) => {
            const response = await fetch(`${env.VITE_API_URL}/v1/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: codeToRun }),
            });
            if (!response.ok) throw new Error('Failed to execute code');
            return response.json();
        },
    });

    useFileSync(webContainer, currentFilePath, codeContent[selectedLanguage]);

    useEffect(() => {
        const loadInitialFile = async () => {
            if (!webContainer) return;
            try {
                const content = await webContainer.fs.readFile(currentFilePath, 'utf-8');
                setCodeContent(prev => ({ ...prev, [selectedLanguage]: content }));
            } catch (error) {
                console.log('File not found, using default content');
            }
        };
        loadInitialFile();
    }, [webContainer, currentFilePath, selectedLanguage]);

    const handleEditorChange = useCallback((value?: string) => {
        setCodeContent(prev => ({ ...prev, [selectedLanguage]: value || '' }));
    }, [selectedLanguage]);

    const handleRun = useCallback(() => {
        if (selectedLanguage === Language.Python) {
            runPythonMutation.mutate(codeContent.python);
        } else {
            console.log('Running TypeScript code:', codeContent.typescript);
        }
    }, [selectedLanguage, codeContent, runPythonMutation]);

    return (
        <div>
            <div className="flex gap-4 space-between px-4">
                <LanguageSelector
                    selectedLanguage={selectedLanguage}
                    onLanguageChange={setSelectedLanguage}
                    className='inline-flex items-center justify-center whitespace-nowrap text-sm font-medium disabled:opacity-50 shadow-sm hover:bg-secondary/80 h-9 py-2 text-primary bg-[var(--gray-3)] px-3 transition-colors focus:outline-none'
                />
                <button
                    className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium disabled:opacity-50 shadow-sm bg-[rgb(245,217,10)] hover:bg-[rgb(255,251,25)] transition-colors duration-500 h-9 py-2 ml-auto px-3 text-black"
                    onClick={handleRun}
                    disabled={selectedLanguage === Language.Python && runPythonMutation.isLoading}
                >
                    {runPythonMutation.isLoading ? 'Running...' : (
                        <span className="inline-flex items-center">
                            <PlayIcon className="h-4 w-4 mr-1" />
                            <span>Run</span>
                        </span>
                    )}
                    <span className="text-gray-600 ml-2">⌘ + Enter</span>
                </button>
            </div>
            <div className="flex">
                <div className="p-4 flex flex-col gap-4 w-[50vw] h-[90vh] border-t border-gray-600">
                    <CodeEditor
                        language={selectedLanguage}
                        code={codeContent[selectedLanguage]}
                        onEditorChange={handleEditorChange}
                        onEditorMount={(editor) => editorRef.current = editor}
                    />

                    {selectedLanguage === Language.TypeScript ? (
                        <div>
                            <div className="w-full max-h-[23vh] rounded-lg" ref={terminalContainerRef} />
                            <TerminalComponent
                                containerRef={terminalContainerRef}
                                shellProcess={shellProcess}
                            />
                        </div>
                    ) : (
                        <PythonResult
                            result={runPythonMutation.data?.result}
                            error={runPythonMutation.data?.error}
                            exitCode={runPythonMutation.data?.exitCode}
                            isError={runPythonMutation.isError}
                        />
                    )}
                </div>
                <div className="p-4 flex flex-col gap-4 w-[50vw] border-t border-gray-600">
                    <iframe
                        src={session?.debugUrl}
                        className="w-full h-[120vh] border-0"
                    ></iframe>
                    <small className="text-xs text-gray-500">Session ID: {session?.id}</small>
                    <SessionLogs id={session?.id!} />
                </div>
            </div>
        </div>
    );
}