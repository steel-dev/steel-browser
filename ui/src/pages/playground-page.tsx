import { LanguageSelector } from '../components/playground/LanguageSelector';
import { CodeEditor } from '../components/playground/CodeEditor';
import { Language } from '@/types/language';
import { editor } from 'monaco-editor';
export function PlaygroundPage() {
    const [selectedLanguage, setSelectedLanguage] = useState<Language>(Language.TypeScript);
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    return (
        <div>
                <LanguageSelector
                    selectedLanguage={selectedLanguage}
                    onLanguageChange={setSelectedLanguage}
                    className='inline-flex items-center justify-center whitespace-nowrap text-sm font-medium disabled:opacity-50 shadow-sm hover:bg-secondary/80 h-9 py-2 text-primary bg-[var(--gray-3)] px-3 transition-colors focus:outline-none'
                />
                <div className="p-4 flex flex-col gap-4 w-[50vw] h-[90vh] border-t border-gray-600">
                    <CodeEditor
                        language={selectedLanguage}
                        onEditorMount={(editor) => editorRef.current = editor}
                    />
            </div>
        </div>
    );
}