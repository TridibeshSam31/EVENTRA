"use client"

import { Badge } from "@/components/reui/badge"
import {
  Frame,
  FrameHeader,
  FramePanel,
} from "@/components/reui/frame"
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline"

import { cn } from "@/lib/utils"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { CheckIcon, ChevronRightIcon, CircleIcon, Zap } from 'lucide-react'

const pipelineSteps = [
  {
    id: 1,
    title: "Source Code Checkout",
    duration: "12s",
    status: "completed",
    description: "Successfully fetched latest changes from the main branch.",
    user: {
      name: "Alex Johnson",
      avatar:
        "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&h=96&dpr=2&q=80",
    },
  },
  {
    id: 2,
    title: "Dependency Installation",
    duration: "1m 45s",
    status: "completed",
    description: "All npm packages installed and cached for future builds.",
    user: {
      name: "Sarah Chen",
      avatar:
        "https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=96&h=96&dpr=2&q=80",
    },
  },
  {
    id: 3,
    title: "Unit & Integration Tests",
    duration: "Running",
    status: "active",
    description: "Running 142 test suites across the entire codebase...",
    user: {
      name: "Michael Rodriguez",
      avatar:
        "https://images.unsplash.com/photo-1584308972272-9e4e7685e80f?w=96&h=96&dpr=2&q=80",
    },
  },
  {
    id: 4,
    title: "Production Build",
    duration: "Pending",
    status: "pending",
    description: "Optimizing assets and generating static site pages.",
    user: {
      name: "Emma Wilson",
      avatar:
        "https://images.unsplash.com/photo-1485893086445-ed75865251e0?w=96&h=96&dpr=2&q=80",
    },
  },
]

function StatusIcon({ status }: { status: string }) {
  if (status === "completed")
    return (
      <CheckIcon  className="size-3.5" />
    )
  if (status === "active") return <Spinner className="size-3.5" />
  return (
    <CircleIcon  className="size-3.5" />
  )
}

function StatusBadge({
  status,
  duration,
}: {
  status: string
  duration: string
}) {
  const variant =
    status === "completed"
      ? "success-light"
      : status === "active"
        ? "info-light"
        : "warning-light"

  return (
    <Badge variant={variant} size="sm">
      {duration}
    </Badge>
  )
}

export function TimelineCard({ tasks = [] }: { tasks?: any[] }) {
  const displayTasks = tasks && tasks.length > 0 ? tasks.slice(0, 5) : pipelineSteps;
  
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-3xl p-6 lg:col-span-2 relative overflow-hidden flex flex-col min-h-[400px] hover:border-white/10 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(214,0,60,0.05)] transition-all duration-300 group">
      <div className="flex justify-between items-center mb-8 relative z-10">
        <div className="flex items-center gap-2">
           <Zap size={18} className="text-[#D6003C]" />
           <h3 className="text-lg font-medium text-white">Event Timeline</h3>
        </div>
        <div className="flex gap-4 text-sm font-medium bg-black/40 border border-white/10 rounded-full px-4 py-1.5">
           <span className="text-gray-400 hover:text-white cursor-pointer transition-colors">Logs</span>
           <span className="text-white cursor-pointer">Live</span>
           <span className="text-gray-400 hover:text-white cursor-pointer transition-colors">Upcoming</span>
        </div>
      </div>
      
      <div className="flex-1 w-full relative z-10 flex flex-col p-4 bg-black/20 rounded-2xl border border-white/5 overflow-y-auto no-scrollbar">
        <div className="w-full max-w-lg mx-auto mt-4">
          <Timeline defaultValue={displayTasks.length > 0 ? (displayTasks[displayTasks.length - 1].id || 3) : 3}>
            {displayTasks.map((step: any, index: number) => {
              const statusValue = step.completed ? "completed" : (index === 0 && !step.completed ? "active" : step.status || "pending");
              return (
                <TimelineItem key={step.id || index} step={step.id || index} className="ms-10 pb-10 text-white">
                  <TimelineHeader>
                    <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-7 border-white/20" />
                    <div className="flex items-center gap-2">
                      <TimelineTitle className="text-sm font-semibold text-white">
                        {step.title}
                      </TimelineTitle>
                      <StatusBadge status={statusValue} duration={step.duration || (step.dueDate || "TBD")} />
                    </div>
                    <TimelineIndicator
                      className={cn(
                        "bg-black border border-white/20 text-gray-400 group-data-completed/timeline-item:bg-[#16A34A] group-data-completed/timeline-item:text-white flex size-6 items-center justify-center group-data-[orientation=vertical]/timeline:-left-7",
                        statusValue === "active" && "ring-[#0284C7]/30 ring-2 border-[#0284C7] bg-[#0284C7]/10 text-[#0284C7]"
                      )}
                    >
                      <StatusIcon status={statusValue} />
                    </TimelineIndicator>
                  </TimelineHeader>
                  <TimelineContent className="mt-2">
                    <Frame stacked dense spacing="sm" className="bg-black/40 border-white/10">
                      <Collapsible defaultOpen className="group/collapsible">
                        <CollapsibleTrigger className="flex w-full hover:bg-white/5 p-2 rounded-lg transition-colors">
                          <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Avatar className="size-5 border border-white/10">
                                <AvatarFallback className="bg-black text-xs">
                                  {step.user?.name?.charAt(0) || step.assignee?.charAt(0) || 'S'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-gray-300 text-xs font-medium">
                                {step.user?.name || step.assignee || 'System'}
                              </span>
                            </div>
                            <ChevronRightIcon  className="text-gray-500 size-4 transition-transform duration-200 group-data-open/collapsible:rotate-90" />
                          </FrameHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <FramePanel className="bg-black/60 border-t border-white/5 p-3 mt-1 rounded-b-lg">
                            <p className="text-gray-400 text-sm leading-relaxed font-mono">
                              {step.description || "System operation logged and timestamped."}
                            </p>
                          </FramePanel>
                        </CollapsibleContent>
                      </Collapsible>
                    </Frame>
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </Timeline>
        </div>
      </div>
    </div>
  )
}
