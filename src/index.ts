#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { closeDatabase } from './database.js';
import {
  memoryWrite,
  memoryRead,
  memorySearch,
  memoryList,
  memoryDelete,
  memoryStats,
} from './tools/memory.js';
import {
  contextSet,
  contextGet,
  contextList,
  contextClear,
  contextShare,
} from './tools/context.js';
import {
  skillRegister,
  skillGet,
  skillList,
  skillUsageStart,
  skillUsageEnd,
  skillRecommend,
  skillStats,
} from './tools/skills.js';
import {
  failureRecord,
  failureSearch,
  failureGet,
  failureList,
  failureUpdate,
  failureStats,
} from './tools/failures.js';

const server = new Server(
  {
    name: 'claude-memory-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const tools = [
  // Memory tools
  {
    name: 'memory_write',
    description: 'Write a memory entry to the knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Unique key for the memory entry (e.g., "tip:typescript:pattern-matching")' },
        content: { type: 'string', description: 'Content of the memory' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorization' },
        scope: { type: 'string', description: 'Scope: "global" or "project:{name}"', default: 'global' },
        source: { type: 'string', description: 'Source of the memory (e.g., "evolve", "manual")' },
      },
      required: ['key', 'content'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read a specific memory entry by key',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key of the memory entry to read' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search memories using full-text search (FTS5)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (supports FTS5 syntax: AND, OR, NOT, "phrase")' },
        scope: { type: 'string', description: 'Optional scope filter' },
        limit: { type: 'number', description: 'Maximum results to return', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_list',
    description: 'List memory entries with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Filter by scope' },
        prefix: { type: 'string', description: 'Filter by key prefix' },
        limit: { type: 'number', description: 'Maximum results', default: 100 },
      },
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete a memory entry',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key of the memory to delete' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_stats',
    description: 'Get memory statistics',
    inputSchema: { type: 'object', properties: {} },
  },

  // Context tools
  {
    name: 'context_set',
    description: 'Set a context value for cross-skill state sharing',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session identifier' },
        key: { type: 'string', description: 'Context key' },
        value: { description: 'Context value (any JSON-serializable type)' },
        skill_name: { type: 'string', description: 'Optional skill name that set this context' },
        expires_in_minutes: { type: 'number', description: 'Optional expiration time in minutes' },
      },
      required: ['session_id', 'key', 'value'],
    },
  },
  {
    name: 'context_get',
    description: 'Get a context value',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session identifier' },
        key: { type: 'string', description: 'Context key' },
      },
      required: ['session_id', 'key'],
    },
  },
  {
    name: 'context_list',
    description: 'List all context values for a session',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session identifier' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'context_clear',
    description: 'Clear context values',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Optional session ID to clear specific session' },
      },
    },
  },
  {
    name: 'context_share',
    description: 'Share context from one session to another',
    inputSchema: {
      type: 'object',
      properties: {
        from_session: { type: 'string', description: 'Source session ID' },
        to_session: { type: 'string', description: 'Target session ID' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Optional specific keys to share' },
      },
      required: ['from_session', 'to_session'],
    },
  },

  // Skill tools
  {
    name: 'skill_register',
    description: 'Register a skill installation',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name' },
        version: { type: 'string', description: 'Skill version' },
        source: { type: 'string', description: 'Source (e.g., "plugin:evolve@evolve-plugin")' },
        project_path: { type: 'string', description: 'Optional project path where installed' },
        installed_by: { type: 'string', description: 'Who installed it' },
      },
      required: ['name', 'version', 'source'],
    },
  },
  {
    name: 'skill_get',
    description: 'Get skill information',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'skill_list',
    description: 'List all registered skills',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Optional project path filter' },
      },
    },
  },
  {
    name: 'skill_usage_start',
    description: 'Start tracking skill usage',
    inputSchema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string', description: 'Name of the skill being used' },
        project_path: { type: 'string', description: 'Optional project path' },
      },
      required: ['skill_name'],
    },
  },
  {
    name: 'skill_usage_end',
    description: 'End skill usage tracking',
    inputSchema: {
      type: 'object',
      properties: {
        usage_id: { type: 'number', description: 'Usage ID from skill_usage_start' },
        success: { type: 'boolean', description: 'Whether the skill usage was successful' },
        outcome: { type: 'string', description: 'Outcome description' },
        tokens_used: { type: 'number', description: 'Estimated tokens used' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['usage_id', 'success'],
    },
  },
  {
    name: 'skill_recommend',
    description: 'Get skill recommendations based on project type and success rates',
    inputSchema: {
      type: 'object',
      properties: {
        project_type: { type: 'string', description: 'Optional project type to filter by' },
        limit: { type: 'number', description: 'Maximum recommendations', default: 5 },
      },
    },
  },
  {
    name: 'skill_stats',
    description: 'Get skill usage statistics',
    inputSchema: { type: 'object', properties: {} },
  },

  // Failure tools
  {
    name: 'failure_record',
    description: 'Record a failure experience for future reference',
    inputSchema: {
      type: 'object',
      properties: {
        error_pattern: { type: 'string', description: 'Error pattern or type' },
        error_message: { type: 'string', description: 'Actual error message' },
        solution: { type: 'string', description: 'Solution that fixed the error' },
        skill_name: { type: 'string', description: 'Related skill name' },
        project_path: { type: 'string', description: 'Project where error occurred' },
      },
      required: ['error_pattern'],
    },
  },
  {
    name: 'failure_search',
    description: 'Search for failure experiences and solutions using FTS5',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for error messages or patterns' },
        limit: { type: 'number', description: 'Maximum results', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'failure_list',
    description: 'List failure experiences',
    inputSchema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string', description: 'Optional skill name filter' },
        limit: { type: 'number', description: 'Maximum results', default: 50 },
      },
    },
  },
  {
    name: 'failure_update',
    description: 'Update a failure record with a solution',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Failure record ID' },
        solution: { type: 'string', description: 'Solution for the failure' },
      },
      required: ['id', 'solution'],
    },
  },
  {
    name: 'failure_stats',
    description: 'Get failure statistics',
    inputSchema: { type: 'object', properties: {} },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: unknown;

    switch (name) {
      // Memory
      case 'memory_write':
        result = memoryWrite(args as unknown as Parameters<typeof memoryWrite>[0]);
        break;
      case 'memory_read':
        result = memoryRead((args as unknown as { key: string }).key);
        break;
      case 'memory_search':
        result = memorySearch(args as unknown as Parameters<typeof memorySearch>[0]);
        break;
      case 'memory_list':
        result = memoryList(args as unknown as Parameters<typeof memoryList>[0]);
        break;
      case 'memory_delete':
        result = memoryDelete((args as unknown as { key: string }).key);
        break;
      case 'memory_stats':
        result = memoryStats();
        break;

      // Context
      case 'context_set':
        result = contextSet(args as unknown as Parameters<typeof contextSet>[0]);
        break;
      case 'context_get':
        result = contextGet(args as unknown as Parameters<typeof contextGet>[0]);
        break;
      case 'context_list':
        result = contextList((args as unknown as { session_id: string }).session_id);
        break;
      case 'context_clear':
        result = contextClear((args as unknown as { session_id?: string }).session_id);
        break;
      case 'context_share':
        result = contextShare(args as unknown as Parameters<typeof contextShare>[0]);
        break;

      // Skills
      case 'skill_register':
        result = skillRegister(args as unknown as Parameters<typeof skillRegister>[0]);
        break;
      case 'skill_get':
        result = skillGet((args as unknown as { name: string }).name);
        break;
      case 'skill_list':
        result = skillList((args as unknown as { project_path?: string }).project_path);
        break;
      case 'skill_usage_start':
        result = skillUsageStart(args as unknown as Parameters<typeof skillUsageStart>[0]);
        break;
      case 'skill_usage_end':
        result = skillUsageEnd(args as unknown as Parameters<typeof skillUsageEnd>[0]);
        break;
      case 'skill_recommend':
        result = skillRecommend(args as unknown as Parameters<typeof skillRecommend>[0]);
        break;
      case 'skill_stats':
        result = skillStats();
        break;

      // Failures
      case 'failure_record':
        result = failureRecord(args as unknown as Parameters<typeof failureRecord>[0]);
        break;
      case 'failure_search':
        result = failureSearch(args as unknown as Parameters<typeof failureSearch>[0]);
        break;
      case 'failure_list':
        result = failureList(args as unknown as Parameters<typeof failureList>[0]);
        break;
      case 'failure_update':
        result = failureUpdate(
          (args as unknown as { id: number; solution: string }).id,
          (args as unknown as { id: number; solution: string }).solution
        );
        break;
      case 'failure_stats':
        result = failureStats();
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: errorMessage }),
        },
      ],
      isError: true,
    };
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claude Memory MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
