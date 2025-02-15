import { Editor } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { Language } from '@/types/language';

interface CodeEditorProps {
    language: Language;
    code: string;
    onEditorChange: (value?: string) => void;
    onEditorMount: (editor: editor.IStandaloneCodeEditor) => void;
}

export function CodeEditor({
    language,
    code,
    onEditorChange,
    onEditorMount
}: CodeEditorProps) {
    function beforeMount(monaco: typeof import('monaco-editor')) {
        const defaultOptions = monaco.languages.typescript.typescriptDefaults.getCompilerOptions();
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            ...defaultOptions,
            allowJs: true,
        });
    }
    return (
        <Editor
            beforeMount={beforeMount}
            theme="vs-dark"
            height="60vh"
            width="100%"
            language={language}
            value={code}
            onChange={onEditorChange}
            onMount={onEditorMount}
            options={{
                minimap: { enabled: false },
                fontSize: 16,
                lineNumbers: 'on',
                roundedSelection: false,
                scrollBeyondLastLine: false,
                automaticLayout: true,
            }}

        />
    );
}