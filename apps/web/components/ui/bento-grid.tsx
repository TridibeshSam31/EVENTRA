import { cn } from "../../lib/utils";
import { MagicCard } from "./magic-card";

export const BentoGrid = ({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) => {
  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6",
        className
      )}
    >
      {children}
    </div>
  );
};

export const BentoGridItem = ({
  className,
  title,
  description,
  header,
  icon,
}: {
  className?: string;
  title?: string | React.ReactNode;
  description?: string | React.ReactNode;
  header?: React.ReactNode;
  icon?: React.ReactNode;
}) => {
  return (
    <MagicCard
      className={cn(
        "row-span-1 rounded-2xl group/bento hover:shadow-xl transition-all duration-300 p-6 flex flex-col space-y-4",
        "border-white/5",
        className
      )}
    >
      <div className="flex-1 w-full relative">
        {header}
      </div>
      <div className="group-hover/bento:translate-x-2 transition duration-200 mt-2">
        <div className="flex items-center gap-2 mb-2 text-primary">
            {icon}
            <div className="font-bold text-white tracking-wide">
            {title}
            </div>
        </div>
        <div className="font-normal text-muted-foreground text-sm">
          {description}
        </div>
      </div>
    </MagicCard>
  );
};
