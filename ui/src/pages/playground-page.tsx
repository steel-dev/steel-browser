import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LanguageSelector } from '../components/playground/LanguageSelector';
import { CodeEditor } from '../components/playground/CodeEditor';
import { TerminalComponent } from '../components/playground/TerminalComponent';
import { useWebContainer } from '@/hooks/use-web-container';
import { useFileSync } from '@/hooks/use-file-sync';
import { INITIAL_FILES } from '../utils/constants';
import { Language } from '@/types/language';
import { editor } from 'monaco-editor';
export function PlaygroundPage() {
    const [selectedLanguage, setSelectedLanguage] = useState<Language>(Language.TypeScript);
    const [codeContent, setCodeContent] = useState({
        python: INITIAL_FILES['main.py'].file.contents,
        typescript: INITIAL_FILES['index.ts'].file.contents
    });

    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const terminalContainerRef = useRef<HTMLDivElement>(null);

    const { webContainer, shellProcess } = useWebContainer(INITIAL_FILES);
    const currentFilePath = selectedLanguage === Language.TypeScript ? '/index.ts' : '/main.py';
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

    return (
        <div>
            <div className="flex gap-4 space-between px-4">
                <LanguageSelector
                    selectedLanguage={selectedLanguage}
                    onLanguageChange={setSelectedLanguage}
                    className='inline-flex items-center justify-center whitespace-nowrap text-sm font-medium disabled:opacity-50 shadow-sm hover:bg-secondary/80 h-9 py-2 text-primary bg-[var(--gray-3)] px-3 transition-colors focus:outline-none'
                />
            </div>
            <div className="flex">
                <div className="p-4 flex flex-col gap-4 w-[50vw] h-[90vh] border-t border-gray-600">
                    <CodeEditor
                        language={selectedLanguage}
                        code={codeContent[selectedLanguage]}
                        onEditorChange={handleEditorChange}
                        onEditorMount={(editor) => editorRef.current = editor}
                    />
                        <div>
                            <div className="w-full max-h-[23vh] rounded-lg" ref={terminalContainerRef} />
                            <TerminalComponent
                                containerRef={terminalContainerRef}
                                shellProcess={shellProcess}
                            />
                </div>
                </div>
            </div>
        </div>
    );
}