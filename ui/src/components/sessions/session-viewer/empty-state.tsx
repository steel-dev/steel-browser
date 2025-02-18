import { Globe } from "@/components/illustrations/globe";
import { ArrowTopRightIcon } from "@radix-ui/react-icons";
import { Link } from "react-router-dom";

export function EmptyState() {
  return (
    <div className="flex flex-col w-full flex-1 px-24 pt-10 bg-[url('/grid.svg')] bg-no-repeat bg-center border-[var(--gray-6)] bg-cover items-center">
      <div className="flex flex-col gap-4 max-w-[396px] mx-auto">
        <div className="flex flex-col gap-4 mx-auto">
          <h1 className="text-primary text-2xl  font-medium text-center">
            This session has no events!
          </h1>
          <p className="text-muted-foreground text-lg text-center max-w-[280px]">
            Double check the logs if you're expecting events.
          </p>
        </div>
        <div className="flex justify-center items-center w-full">
          <Globe />
        </div>
        <div className="flex flex-col gap-2 justify-center items-center">
          <p className="text-muted-foreground text-lg text-center max-w-[280px]">
            If you think this is an error, message us on Discord.
          </p>
          <Link
            to="https://discord.gg/steel-dev"
            target="_blank"
            className="flex items-center py-2 gap-1 text-[var(--indigo-11)] text-sm hover:text-[var(--indigo-12)] cursor-pointer"
          >
            Go to Discord
            <ArrowTopRightIcon width={16} height={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
