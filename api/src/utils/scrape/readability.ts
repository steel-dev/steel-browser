import { Defuddle } from "defuddle/node";

export const getDefuddleContent = async (htmlString: string, url?: string) => {
  const defuddle = await Defuddle(htmlString, url, {
    debug: false,
    separateMarkdown: true,
    useAsync: false,
  });

  return defuddle;
};
