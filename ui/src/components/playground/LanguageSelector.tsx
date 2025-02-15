import type { Language } from '@/types/language';

interface LanguageSelectorProps {
    selectedLanguage: Language;
    onLanguageChange: (lang: Language) => void;
    className?: string;
}

export function LanguageSelector({
    selectedLanguage,
    onLanguageChange,
    className
}: LanguageSelectorProps) {
    return (
        <select
            value={selectedLanguage}
            onChange={(e) => onLanguageChange(e.target.value as Language)}
            className={className}
        >
            <option value="python">Python</option>
            <option value="typescript">TypeScript</option>
        </select>
    );
}