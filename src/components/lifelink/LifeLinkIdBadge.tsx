import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Copy, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface LifeLinkIdBadgeProps {
  className?: string;
}

export function LifeLinkIdBadge({ className }: LifeLinkIdBadgeProps) {
  const id = useQuery(api.profiles.myLifeLinkId);

  const handleCopy = async () => {
    if (!id?.lifeLinkId) return;
    try {
      await navigator.clipboard.writeText(id.lifeLinkId);
      toast.success("LifeLink ID copied", {
        description: `Your permanent ID is ${id.lifeLinkId}. It stays with this account for life.`,
      });
    } catch {
      toast.error("Could not copy LifeLink ID");
    }
  };

  if (!id || !id.lifeLinkId) return null;

  return (
    <div className={className ?? ""}>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5">
        <ShieldCheck className="size-3.5 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            LifeLink ID
          </p>
          <p className="text-[12px] font-semibold font-mono">{id.lifeLinkId}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 h-7 gap-1 px-2 text-[10.5px]"
          onClick={handleCopy}
          disabled={!id.lifeLinkId}
        >
          <Copy className="size-3" />
          Copy ID
        </Button>
      </div>
    </div>
  );
}
