export interface DesignKnowledgeModule {
  id: string;
  name: string;
  description: string;
  content: string;
}

export const DESIGN_KNOWLEDGE_MODULES = new Map<string, DesignKnowledgeModule>();
