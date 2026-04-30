export interface ActionEntry {
  id: string;
  command: string;
  params: any;
  result: any;
  error: string | null;
  status: "running" | "success" | "error";
  timestamp: number;
  nodeIds?: string[];
}
