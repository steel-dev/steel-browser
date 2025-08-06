import { Defuddle } from "defuddle/node";

export const getDefuddleContent = async (htmlString: string) => {
  const defuddle = await Defuddle(htmlString, undefined, {
    debug: false,
    markdown: false,
  });

  return defuddle;
};
