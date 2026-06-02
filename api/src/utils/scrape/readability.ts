import { Defuddle } from "defuddle/node";

export const getDefuddleContent = async (htmlString: string) => {
  const defuddle = await Defuddle(htmlString, undefined, {
    debug: false,
    separateMarkdown: true,
  });

  return defuddle;
};
