import {
  DialogHeader,
  DialogFooter,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { useSessionsContext } from "@/hooks/use-sessions-context";
import { useState } from "react";

export const ReleaseSessionDialog = ({
  children,
  id,
}: {
  id: string;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const { useReleaseSessionMutation } = useSessionsContext();

  const {
    mutate: releaseSession,
    isLoading,
  } = useReleaseSessionMutation();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-[425px] bg-[var(--gray-2)] border-[var(--gray-6)] text-[var(--gray-12)]">
        <DialogHeader>
          <DialogTitle>Are you absolutely sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will release your session and
            delete all your session data.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {!isLoading && (
            <Button
              variant="outline"
              className="text-[var(--gray-12)] bg-[var(--gray-3)]"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="outline"
            className="text-[var(--red-11)] border-[var(--red-7)] hover:bg-[var(--red-3)]"
            disabled={isLoading}
            onClick={() => {
              releaseSession(id, { onSuccess: () => setOpen(false) });
            }}
          >
            {isLoading ? "Releasing Session..." : "Release Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
