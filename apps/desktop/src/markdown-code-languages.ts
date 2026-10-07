import { LanguageDescription } from '@codemirror/language';

const codeLanguages = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'node'],
    extensions: ['js', 'jsx', 'ts', 'tsx'],
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['css'],
    extensions: ['css'],
    load: async () => (await import('@codemirror/lang-css')).css(),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html', 'xml', 'svg'],
    extensions: ['html', 'htm', 'xml', 'svg'],
    load: async () => (await import('@codemirror/lang-html')).html(),
  }),
  LanguageDescription.of({ name: 'JSON', alias: ['json', 'jsonc'], extensions: ['json'], load: async () => (await import('@codemirror/lang-json')).json() }),
  LanguageDescription.of({ name: 'Python', alias: ['py', 'python', 'python3', 'py3'], extensions: ['py'], load: async () => (await import('@codemirror/lang-python')).python() }),
  LanguageDescription.of({ name: 'Rust', alias: ['rs', 'rust'], extensions: ['rs'], load: async () => (await import('@codemirror/lang-rust')).rust() }),
  LanguageDescription.of({ name: 'SQL', alias: ['sql'], extensions: ['sql'], load: async () => (await import('@codemirror/lang-sql')).sql() }),
  LanguageDescription.of({ name: 'YAML', alias: ['yml', 'yaml'], extensions: ['yaml', 'yml'], load: async () => (await import('@codemirror/lang-yaml')).yaml() }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['bash', 'sh', 'shell', 'zsh', 'console'],
    extensions: ['sh', 'bash', 'zsh'],
    load: async () => {
      const [{ LanguageSupport, StreamLanguage }, { shell }] = await Promise.all([
        import('@codemirror/language'),
        import('@codemirror/legacy-modes/mode/shell'),
      ]);
      return new LanguageSupport(StreamLanguage.define(shell as unknown as import('@codemirror/language').StreamParser<unknown>));
    },
  }),
];

export function codeLanguageForFence(info: string) {
  return LanguageDescription.matchLanguageName(codeLanguages, info, true);
}
