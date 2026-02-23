"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // src/claude_mcp_plugin/utils/helpers.ts
  var DEBUG = false;
  function debugLog(...args) {
    if (DEBUG) console.log(...args);
  }
  function sendProgressUpdate(commandId, commandType, status, progress, totalItems, processedItems, message, payload = null) {
    const update = {
      type: "command_progress",
      commandId,
      commandType,
      status,
      progress,
      totalItems,
      processedItems,
      message,
      timestamp: Date.now()
    };
    if (payload !== null) {
      if (payload.currentChunk !== void 0 && payload.totalChunks !== void 0) {
        update.currentChunk = payload.currentChunk;
        update.totalChunks = payload.totalChunks;
        update.chunkSize = payload.chunkSize;
      }
      update.payload = payload;
    }
    figma.ui.postMessage(update);
    debugLog(`Progress update: ${status} - ${progress}% - ${message}`);
    return update;
  }
  function uniqBy(arr, predicate) {
    const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
    return [
      ...arr.reduce((map, item) => {
        const key = item === null || item === void 0 ? item : cb(item);
        if (!map.has(key)) {
          map.set(key, item);
        }
        return map;
      }, /* @__PURE__ */ new Map()).values()
    ];
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function generateCommandId() {
    return "cmd_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
  function parseNum(x, fallback) {
    const v = parseFloat(x);
    return isNaN(v) ? fallback : v;
  }
  function getFontStyle(weight) {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  }

  // src/claude_mcp_plugin/handlers/document.ts
  async function getFileKey() {
    const fileKey = figma.fileKey;
    if (!fileKey) {
      throw new Error("File key not available. Make sure you're in a saved Figma file.");
    }
    return {
      fileKey,
      fileName: figma.root.name
    };
  }
  async function getDocumentInfo() {
    await figma.currentPage.loadAsync();
    const page = figma.currentPage;
    return {
      name: page.name,
      id: page.id,
      type: page.type,
      children: page.children.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type
      })),
      currentPage: {
        id: page.id,
        name: page.name,
        childCount: page.children.length
      },
      // Note: childCount for non-current pages may be 0 if the page has not been
      // loaded yet (Figma only loads the current page automatically). Use
      // get_node_info on a specific page to get accurate child counts.
      pages: figma.root.children.map((p) => ({
        id: p.id,
        name: p.name,
        childCount: "children" in p ? p.children.length : 0
      }))
    };
  }
  function exportAsJsonV1(node) {
    return node.exportAsync({ format: "JSON_REST_V1" });
  }
  async function getSelection() {
    return {
      selectionCount: figma.currentPage.selection.length,
      selection: figma.currentPage.selection.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible
      }))
    };
  }
  function stripImageData(obj) {
    if (!obj || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(stripImageData);
    }
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "imageRef" || key === "imageBytes" || key === "gifRef") {
        result[key] = "[IMAGE_DATA_STRIPPED]";
        continue;
      }
      result[key] = stripImageData(value);
    }
    return result;
  }
  async function getNodeInfo(nodeId, options = {}) {
    const stripImages = options.stripImages !== void 0 ? options.stripImages : true;
    debugLog("getNodeInfo", nodeId, options);
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    const response = await exportAsJsonV1(node);
    let document = response.document;
    if (stripImages) {
      document = stripImageData(document);
    }
    return document;
  }
  async function getNodesInfo(nodeIds, options = {}) {
    const stripImages = options.stripImages !== void 0 ? options.stripImages : true;
    debugLog("getNodesInfo", nodeIds, options);
    try {
      const nodes = await Promise.all(
        nodeIds.map((id) => figma.getNodeByIdAsync(id))
      );
      const validNodes = nodes.filter((node) => node !== null);
      const responses = await Promise.all(
        validNodes.map(async (node) => {
          const response = await exportAsJsonV1(node);
          let document = response.document;
          if (stripImages) {
            document = stripImageData(document);
          }
          return {
            nodeId: node.id,
            document
          };
        })
      );
      return responses;
    } catch (error) {
      throw new Error(`Error getting nodes info: ${error.message}`);
    }
  }

  // src/claude_mcp_plugin/handlers/pages.ts
  async function createPage(params) {
    const name = params !== null && params !== void 0 ? params.name : void 0;
    if (!name || !name.trim()) {
      throw new Error("Missing or empty name parameter");
    }
    const trimmedName = name.trim();
    const existing = figma.root.children.find(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (existing) {
      throw new Error(`A page named "${existing.name}" already exists (ID: ${existing.id})`);
    }
    const page = figma.createPage();
    page.name = trimmedName;
    return {
      id: page.id,
      name: page.name
    };
  }
  async function renamePage(params) {
    const pageId = params !== null && params !== void 0 ? params.pageId : void 0;
    const name = params !== null && params !== void 0 ? params.name : void 0;
    if (!pageId) {
      throw new Error("Missing pageId parameter");
    }
    if (!name || !name.trim()) {
      throw new Error("Missing or empty name parameter");
    }
    const node = await figma.getNodeByIdAsync(pageId);
    if (!node) {
      throw new Error(`Page not found with ID: ${pageId}`);
    }
    if (node.type !== "PAGE") {
      throw new Error(`Node ${pageId} is not a page (type: ${node.type})`);
    }
    const trimmedName = name.trim();
    const existing = figma.root.children.find(
      (p) => p.id !== pageId && p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (existing) {
      throw new Error(`A page named "${existing.name}" already exists (ID: ${existing.id})`);
    }
    const page = node;
    const oldName = page.name;
    page.name = trimmedName;
    return {
      id: page.id,
      oldName,
      newName: page.name
    };
  }
  async function deletePage(params) {
    const pageId = params !== null && params !== void 0 ? params.pageId : void 0;
    if (!pageId) {
      throw new Error("Missing pageId parameter");
    }
    if (figma.root.children.length <= 1) {
      throw new Error("Cannot delete the last remaining page");
    }
    const node = await figma.getNodeByIdAsync(pageId);
    if (!node) {
      throw new Error(`Page not found with ID: ${pageId}`);
    }
    if (node.type !== "PAGE") {
      throw new Error(`Node ${pageId} is not a page (type: ${node.type})`);
    }
    if (figma.currentPage.id === pageId) {
      const nextPage = figma.root.children.find((p) => p.id !== pageId);
      if (nextPage) {
        figma.currentPage = nextPage;
      }
    }
    const pageInfo = {
      id: node.id,
      name: node.name
    };
    node.remove();
    return pageInfo;
  }

  // src/claude_mcp_plugin/handlers/prototyping.ts
  async function getReactions(params) {
    const nodeIds = params["nodeIds"];
    if (!Array.isArray(nodeIds)) {
      throw new Error("nodeIds must be an array");
    }
    const typedNodeIds = nodeIds;
    const results = [];
    for (const id of typedNodeIds) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node) continue;
      if ("reactions" in node) {
        const reactiveNode = node;
        results.push({
          nodeId: reactiveNode.id,
          nodeName: reactiveNode.name,
          reactionCount: reactiveNode.reactions.length,
          reactions: reactiveNode.reactions.map((reaction) => ({
            trigger: reaction.trigger !== null && reaction.trigger !== void 0 ? { type: reaction.trigger.type } : null,
            actions: reaction.actions.map((action) => {
              const actionInfo = {
                type: action.type
              };
              if (action.type === "NODE" && action.destinationId) {
                actionInfo.destinationId = action.destinationId;
              }
              return actionInfo;
            })
          }))
        });
      }
    }
    return {
      nodeCount: nodeIds.length,
      nodesWithReactions: results.length,
      reactions: results
    };
  }
  async function setDefaultConnector(params) {
    const connectorId = params["connectorId"];
    const connector = await figma.getNodeByIdAsync(connectorId);
    if (!connector) {
      throw new Error(`Connector node with ID ${connectorId} not found`);
    }
    if (connector.type !== "CONNECTOR") {
      throw new Error(`Node "${connector.name}" is not a connector (type: ${connector.type})`);
    }
    return {
      connectorId: connector.id,
      connectorName: connector.name,
      message: "Default connector setting is not available in Figma Plugin API. Use Figma UI.",
      success: false
    };
  }
  async function createConnections(params) {
    const connections = params["connections"];
    if (!Array.isArray(connections)) {
      throw new Error("connections must be an array");
    }
    const typedConnections = connections;
    const results = [];
    for (const conn of typedConnections) {
      const { startNodeId, endNodeId, text } = conn;
      const startNode = await figma.getNodeByIdAsync(startNodeId);
      const endNode = await figma.getNodeByIdAsync(endNodeId);
      if (!startNode || !endNode) {
        results.push({
          startNodeId,
          endNodeId,
          success: false,
          error: "One or both nodes not found"
        });
        continue;
      }
      try {
        const connector = figma.createConnector();
        connector.connectorStart = {
          endpointNodeId: startNode.id,
          magnet: "AUTO"
        };
        connector.connectorEnd = {
          endpointNodeId: endNode.id,
          magnet: "AUTO"
        };
        if (text) {
          connector.connectorLineType = "ELBOWED";
        }
        figma.currentPage.appendChild(connector);
        results.push({
          startNodeId,
          endNodeId,
          connectorId: connector.id,
          success: true
        });
      } catch (error) {
        results.push({
          startNodeId,
          endNodeId,
          success: false,
          error: error.message
        });
      }
    }
    return {
      totalRequested: connections.length,
      successCount: results.filter((r) => r.success).length,
      failedCount: results.filter((r) => !r.success).length,
      connections: results
    };
  }

  // src/claude_mcp_plugin/utils/base64.ts
  function customBase64Encode(bytes) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let base64 = "";
    const byteLength = bytes.byteLength;
    const byteRemainder = byteLength % 3;
    const mainLength = byteLength - byteRemainder;
    let a;
    let b;
    let c;
    let d;
    let chunk;
    for (let i = 0; i < mainLength; i = i + 3) {
      chunk = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
      a = (chunk & 16515072) >> 18;
      b = (chunk & 258048) >> 12;
      c = (chunk & 4032) >> 6;
      d = chunk & 63;
      base64 += chars[a] + chars[b] + chars[c] + chars[d];
    }
    if (byteRemainder === 1) {
      chunk = bytes[mainLength];
      a = (chunk & 252) >> 2;
      b = (chunk & 3) << 4;
      base64 += chars[a] + chars[b] + "==";
    } else if (byteRemainder === 2) {
      chunk = bytes[mainLength] << 8 | bytes[mainLength + 1];
      a = (chunk & 64512) >> 10;
      b = (chunk & 1008) >> 4;
      c = (chunk & 15) << 2;
      base64 += chars[a] + chars[b] + chars[c] + "=";
    }
    return base64;
  }

  // src/claude_mcp_plugin/handlers/nodes.ts
  async function createRectangle(params) {
    const x = params !== null && params !== void 0 && params["x"] !== null && params["x"] !== void 0 ? params["x"] : 0;
    const y = params !== null && params !== void 0 && params["y"] !== null && params["y"] !== void 0 ? params["y"] : 0;
    const width = params !== null && params !== void 0 && params["width"] !== null && params["width"] !== void 0 ? params["width"] : 100;
    const height = params !== null && params !== void 0 && params["height"] !== null && params["height"] !== void 0 ? params["height"] : 100;
    const name = params !== null && params !== void 0 && params["name"] !== null && params["name"] !== void 0 ? params["name"] : "Rectangle";
    const parentId = params !== null && params !== void 0 ? params["parentId"] : void 0;
    const layoutPositioning = params !== null && params !== void 0 ? params["layoutPositioning"] : void 0;
    const rect = figma.createRectangle();
    rect.x = x;
    rect.y = y;
    rect.resize(width, height);
    rect.name = name;
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(rect);
    } else {
      figma.currentPage.appendChild(rect);
    }
    if (layoutPositioning !== void 0) {
      rect.layoutPositioning = layoutPositioning;
      rect.x = x;
      rect.y = y;
    }
    return {
      id: rect.id,
      name: rect.name,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      parentId: rect.parent ? rect.parent.id : void 0
    };
  }
  async function createFrame(params) {
    const x = params !== null && params !== void 0 && params["x"] !== null && params["x"] !== void 0 ? params["x"] : 0;
    const y = params !== null && params !== void 0 && params["y"] !== null && params["y"] !== void 0 ? params["y"] : 0;
    const width = params !== null && params !== void 0 && params["width"] !== null && params["width"] !== void 0 ? params["width"] : 100;
    const height = params !== null && params !== void 0 && params["height"] !== null && params["height"] !== void 0 ? params["height"] : 100;
    const name = params !== null && params !== void 0 && params["name"] !== null && params["name"] !== void 0 ? params["name"] : "Frame";
    const parentId = params !== null && params !== void 0 ? params["parentId"] : void 0;
    const fillColor = params !== null && params !== void 0 ? params["fillColor"] : void 0;
    const strokeColor = params !== null && params !== void 0 ? params["strokeColor"] : void 0;
    const strokeWeight = params !== null && params !== void 0 ? params["strokeWeight"] : void 0;
    const clipsContent = params !== null && params !== void 0 ? params["clipsContent"] : void 0;
    const layoutPositioning = params !== null && params !== void 0 ? params["layoutPositioning"] : void 0;
    const frame = figma.createFrame();
    frame.x = x;
    frame.y = y;
    frame.resize(width, height);
    frame.name = name;
    if (fillColor) {
      const paintStyle = {
        type: "SOLID",
        color: {
          r: parseNum(fillColor["r"], 0),
          g: parseNum(fillColor["g"], 0),
          b: parseNum(fillColor["b"], 0)
        },
        opacity: parseNum(fillColor["a"], 1)
      };
      frame.fills = [paintStyle];
    }
    if (strokeColor) {
      const strokeStyle = {
        type: "SOLID",
        color: {
          r: parseNum(strokeColor["r"], 0),
          g: parseNum(strokeColor["g"], 0),
          b: parseNum(strokeColor["b"], 0)
        },
        opacity: parseNum(strokeColor["a"], 1)
      };
      frame.strokes = [strokeStyle];
    }
    if (strokeWeight !== void 0) {
      frame.strokeWeight = strokeWeight;
    }
    if (clipsContent !== void 0) {
      frame.clipsContent = clipsContent;
    }
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(frame);
    } else {
      figma.currentPage.appendChild(frame);
    }
    if (layoutPositioning !== void 0) {
      frame.layoutPositioning = layoutPositioning;
      frame.x = x;
      frame.y = y;
    }
    return {
      id: frame.id,
      name: frame.name,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      fills: frame.fills,
      strokes: frame.strokes,
      strokeWeight: frame.strokeWeight,
      clipsContent: frame.clipsContent,
      parentId: frame.parent ? frame.parent.id : void 0
    };
  }
  async function moveNode(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const x = params !== null && params !== void 0 ? params["x"] : void 0;
    const y = params !== null && params !== void 0 ? params["y"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (x === void 0 || y === void 0) {
      throw new Error("Missing x or y parameters");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("x" in node) || !("y" in node)) {
      throw new Error(`Node does not support position: ${nodeId}`);
    }
    node.x = x;
    node.y = y;
    return {
      id: node.id,
      name: node.name,
      x: node.x,
      y: node.y
    };
  }
  async function resizeNode(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const width = params !== null && params !== void 0 ? params["width"] : void 0;
    const height = params !== null && params !== void 0 ? params["height"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (width === void 0 || height === void 0) {
      throw new Error("Missing width or height parameters");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("resize" in node)) {
      throw new Error(`Node does not support resizing: ${nodeId}`);
    }
    node.resize(width, height);
    return {
      id: node.id,
      name: node.name,
      width: node.width,
      height: node.height
    };
  }
  async function deleteNode(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    const nodeInfo = {
      id: node.id,
      name: node.name,
      type: node.type
    };
    node.remove();
    return nodeInfo;
  }
  async function deleteMultipleNodes(params) {
    const nodeIds = params !== null && params !== void 0 ? params["nodeIds"] : void 0;
    if (!nodeIds || !Array.isArray(nodeIds)) {
      throw new Error("Missing or invalid nodeIds parameter - must be an array");
    }
    if (nodeIds.length === 0) {
      throw new Error("nodeIds array is empty");
    }
    const deletedNodes = [];
    const errors = [];
    for (const nodeId of nodeIds) {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
          errors.push({ nodeId, error: `Node not found with ID: ${nodeId}` });
          continue;
        }
        const nodeInfo = {
          id: node.id,
          name: node.name,
          type: node.type
        };
        node.remove();
        deletedNodes.push(nodeInfo);
      } catch (error) {
        errors.push({ nodeId, error: error.message });
      }
    }
    return {
      deletedNodes,
      deletedCount: deletedNodes.length,
      errors: errors.length > 0 ? errors : void 0,
      totalRequested: nodeIds.length
    };
  }
  async function exportNodeAsImage(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const scale = params !== null && params !== void 0 && params["scale"] !== null && params["scale"] !== void 0 ? params["scale"] : 1;
    const format = "PNG";
    const MAX_DIMENSION = 7680;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("exportAsync" in node)) {
      throw new Error(`Node does not support exporting: ${nodeId}`);
    }
    try {
      const nodeWidth = ("width" in node ? node.width : 0) || 0;
      const nodeHeight = ("height" in node ? node.height : 0) || 0;
      let finalScale = scale;
      const scaledWidth = nodeWidth * scale;
      const scaledHeight = nodeHeight * scale;
      if (scaledWidth > MAX_DIMENSION || scaledHeight > MAX_DIMENSION) {
        const maxDimension = Math.max(scaledWidth, scaledHeight);
        finalScale = MAX_DIMENSION / maxDimension * scale;
        debugLog(`exportNodeAsImage: Auto-reducing scale from ${scale} to ${finalScale.toFixed(3)} to fit within ${MAX_DIMENSION}px limit`);
      }
      const settings = {
        format,
        constraint: { type: "SCALE", value: finalScale }
      };
      const bytes = await node.exportAsync(settings);
      const formatStr = format;
      let mimeType;
      if (formatStr === "PNG") {
        mimeType = "image/png";
      } else if (formatStr === "JPG") {
        mimeType = "image/jpeg";
      } else if (formatStr === "SVG") {
        mimeType = "image/svg+xml";
      } else if (formatStr === "PDF") {
        mimeType = "application/pdf";
      } else {
        mimeType = "application/octet-stream";
      }
      const base64 = customBase64Encode(bytes);
      return {
        nodeId,
        format,
        requestedScale: scale,
        actualScale: finalScale,
        originalWidth: nodeWidth,
        originalHeight: nodeHeight,
        exportedWidth: Math.round(nodeWidth * finalScale),
        exportedHeight: Math.round(nodeHeight * finalScale),
        mimeType,
        imageData: base64
      };
    } catch (error) {
      throw new Error(`Error exporting node as image: ${error.message}`);
    }
  }
  async function setCornerRadius(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const radius = params !== null && params !== void 0 ? params["radius"] : void 0;
    const corners = params !== null && params !== void 0 ? params["corners"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (radius === void 0) {
      throw new Error("Missing radius parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("cornerRadius" in node)) {
      throw new Error(`Node does not support corner radius: ${nodeId}`);
    }
    const cornerNode = node;
    if (corners && Array.isArray(corners) && corners.length === 4) {
      if ("topLeftRadius" in node) {
        if (corners[0] === true) cornerNode.topLeftRadius = radius;
        if (corners[1] === true) cornerNode.topRightRadius = radius;
        if (corners[2] === true) cornerNode.bottomRightRadius = radius;
        if (corners[3] === true) cornerNode.bottomLeftRadius = radius;
      } else {
        cornerNode.cornerRadius = radius;
      }
    } else {
      cornerNode.cornerRadius = radius;
    }
    return {
      id: node.id,
      name: node.name,
      cornerRadius: "cornerRadius" in node ? cornerNode.cornerRadius : void 0,
      topLeftRadius: "topLeftRadius" in node ? cornerNode.topLeftRadius : void 0,
      topRightRadius: "topRightRadius" in node ? cornerNode.topRightRadius : void 0,
      bottomRightRadius: "bottomRightRadius" in node ? cornerNode.bottomRightRadius : void 0,
      bottomLeftRadius: "bottomLeftRadius" in node ? cornerNode.bottomLeftRadius : void 0
    };
  }
  async function cloneNode(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const x = params !== null && params !== void 0 ? params["x"] : void 0;
    const y = params !== null && params !== void 0 ? params["y"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    const clone = node.clone();
    if (x !== void 0 && y !== void 0) {
      if (!("x" in clone) || !("y" in clone)) {
        throw new Error(`Cloned node does not support position: ${nodeId}`);
      }
      clone.x = x;
      clone.y = y;
    }
    if (node.parent) {
      node.parent.appendChild(clone);
    } else {
      figma.currentPage.appendChild(clone);
    }
    return {
      id: clone.id,
      name: clone.name,
      x: "x" in clone ? clone.x : void 0,
      y: "y" in clone ? clone.y : void 0,
      width: "width" in clone ? clone.width : void 0,
      height: "height" in clone ? clone.height : void 0
    };
  }
  async function groupNodes(params) {
    const nodeIds = params !== null && params !== void 0 ? params["nodeIds"] : void 0;
    const name = params !== null && params !== void 0 ? params["name"] : void 0;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
      throw new Error("Must provide at least two nodeIds to group");
    }
    try {
      const nodesToGroup = [];
      for (const nodeId of nodeIds) {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
          throw new Error(`Node not found with ID: ${nodeId}`);
        }
        nodesToGroup.push(node);
      }
      const parent = nodesToGroup[0].parent;
      for (const node of nodesToGroup) {
        if (node.parent !== parent) {
          throw new Error("All nodes must have the same parent to be grouped");
        }
      }
      const group = figma.group(nodesToGroup, parent);
      if (name) {
        group.name = name;
      }
      return {
        id: group.id,
        name: group.name,
        type: group.type,
        children: group.children.map((child) => ({ id: child.id, name: child.name, type: child.type }))
      };
    } catch (error) {
      throw new Error(`Error grouping nodes: ${error.message}`);
    }
  }
  async function ungroupNodes(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      if (node.type !== "GROUP" && node.type !== "FRAME") {
        throw new Error(`Node with ID ${nodeId} is not a GROUP or FRAME`);
      }
      const ungroupedItems = figma.ungroup(node);
      return {
        success: true,
        ungroupedCount: ungroupedItems.length,
        items: ungroupedItems.map((item) => ({ id: item.id, name: item.name, type: item.type }))
      };
    } catch (error) {
      throw new Error(`Error ungrouping node: ${error.message}`);
    }
  }
  async function flattenNode(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      const flattenableTypes = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE", "RECTANGLE"];
      if (!flattenableTypes.includes(node.type)) {
        throw new Error(`Node with ID ${nodeId} and type ${node.type} cannot be flattened. Only vector-based nodes can be flattened.`);
      }
      if (typeof node.flatten !== "function") {
        throw new Error(`Node with ID ${nodeId} does not support the flatten operation.`);
      }
      const flattenableNode = node;
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Flatten operation timed out after 8 seconds. The node may be too complex."));
        }, 8e3);
      });
      const flattenPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            debugLog(`Starting flatten operation for node ID ${nodeId}...`);
            const flattened2 = flattenableNode.flatten();
            debugLog(`Flatten operation completed successfully for node ID ${nodeId}`);
            resolve(flattened2);
          } catch (err) {
            console.error(`Error during flatten operation: ${err.message}`);
            reject(err);
          }
        }, 0);
      });
      let flattened;
      try {
        flattened = await Promise.race([flattenPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
      return {
        id: flattened.id,
        name: flattened.name,
        type: flattened.type
      };
    } catch (error) {
      console.error(`Error in flattenNode: ${error.message}`);
      if (error.message.includes("timed out")) {
        throw new Error("The flatten operation timed out. This usually happens with complex nodes. Try simplifying the node first or breaking it into smaller parts.");
      } else {
        throw new Error(`Error flattening node: ${error.message}`);
      }
    }
  }
  async function renameNode(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const name = params !== null && params !== void 0 ? params["name"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!name) {
      throw new Error("Missing name parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      const oldName = node.name;
      node.name = name;
      return {
        id: node.id,
        oldName,
        newName: node.name
      };
    } catch (error) {
      throw new Error(`Error renaming node: ${error.message}`);
    }
  }
  async function insertChild(params) {
    const parentId = params !== null && params !== void 0 ? params["parentId"] : void 0;
    const childId = params !== null && params !== void 0 ? params["childId"] : void 0;
    const index = params !== null && params !== void 0 ? params["index"] : void 0;
    if (!parentId) {
      throw new Error("Missing parentId parameter");
    }
    if (!childId) {
      throw new Error("Missing childId parameter");
    }
    try {
      const parent = await figma.getNodeByIdAsync(parentId);
      if (!parent) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      const child = await figma.getNodeByIdAsync(childId);
      if (!child) {
        throw new Error(`Child node not found with ID: ${childId}`);
      }
      if (!("appendChild" in parent)) {
        throw new Error(`Parent node with ID ${parentId} cannot have children`);
      }
      const parentWithChildren = parent;
      const childScene = child;
      const originalParent = childScene.parent;
      if (index !== void 0 && index >= 0 && index <= parentWithChildren.children.length) {
        parentWithChildren.insertChild(index, childScene);
      } else {
        parentWithChildren.appendChild(childScene);
      }
      const newIndex = parentWithChildren.children.indexOf(childScene);
      return {
        parentId: parent.id,
        childId: child.id,
        index: newIndex,
        success: newIndex !== -1,
        previousParentId: originalParent ? originalParent.id : null
      };
    } catch (error) {
      console.error(`Error inserting child: ${error.message}`, error);
      throw new Error(`Error inserting child: ${error.message}`);
    }
  }

  // src/claude_mcp_plugin/handlers/fills.ts
  async function setFillColor(params) {
    debugLog("setFillColor", params);
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const nodeId = paramsObj["nodeId"];
    const colorObj = paramsObj["color"];
    const source = colorObj !== null && colorObj !== void 0 ? colorObj : paramsObj;
    const r = source["r"];
    const g = source["g"];
    const b = source["b"];
    const a = source["a"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("fills" in node)) {
      throw new Error(`Node does not support fills: ${nodeId}`);
    }
    if (r === void 0 || g === void 0 || b === void 0 || a === void 0) {
      throw new Error(
        "Incomplete color data received from MCP layer. All RGBA components must be provided."
      );
    }
    const rgbColor = {
      r: parseFloat(r),
      g: parseFloat(g),
      b: parseFloat(b),
      a: parseFloat(a)
    };
    if (isNaN(rgbColor.r) || isNaN(rgbColor.g) || isNaN(rgbColor.b) || isNaN(rgbColor.a)) {
      throw new Error(
        "Invalid color values received - all components must be valid numbers"
      );
    }
    const paintStyle = {
      type: "SOLID",
      color: {
        r: rgbColor.r,
        g: rgbColor.g,
        b: rgbColor.b
      },
      opacity: rgbColor.a
    };
    debugLog("paintStyle", paintStyle);
    node.fills = [paintStyle];
    return {
      id: node.id,
      name: node.name,
      fills: [paintStyle]
    };
  }
  async function setStrokeColor(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const nodeId = paramsObj["nodeId"];
    const colorObj = paramsObj["color"];
    const strokeWeight = paramsObj["strokeWeight"];
    const source = colorObj !== null && colorObj !== void 0 ? colorObj : paramsObj;
    const r = source["r"];
    const g = source["g"];
    const b = source["b"];
    const a = source["a"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("strokes" in node)) {
      throw new Error(`Node does not support strokes: ${nodeId}`);
    }
    if (r === void 0 || g === void 0 || b === void 0 || a === void 0) {
      throw new Error(
        "Incomplete color data received from MCP layer. All RGBA components must be provided."
      );
    }
    if (strokeWeight === void 0) {
      throw new Error("Stroke weight must be provided by MCP layer.");
    }
    const rgbColor = {
      r: parseFloat(r),
      g: parseFloat(g),
      b: parseFloat(b),
      a: parseFloat(a)
    };
    const strokeWeightParsed = parseFloat(strokeWeight);
    if (isNaN(rgbColor.r) || isNaN(rgbColor.g) || isNaN(rgbColor.b) || isNaN(rgbColor.a)) {
      throw new Error(
        "Invalid color values received - all components must be valid numbers"
      );
    }
    if (isNaN(strokeWeightParsed)) {
      throw new Error("Invalid stroke weight - must be a valid number");
    }
    const paintStyle = {
      type: "SOLID",
      color: {
        r: rgbColor.r,
        g: rgbColor.g,
        b: rgbColor.b
      },
      opacity: rgbColor.a
    };
    node.strokes = [paintStyle];
    if ("strokeWeight" in node) {
      node.strokeWeight = strokeWeightParsed;
    }
    return {
      id: node.id,
      name: node.name,
      strokes: node.strokes,
      strokeWeight: "strokeWeight" in node ? node.strokeWeight : void 0
    };
  }
  async function setImageFill(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const nodeId = paramsObj["nodeId"];
    const imageUrl = paramsObj["imageUrl"];
    const scaleMode = paramsObj["scaleMode"] !== void 0 ? paramsObj["scaleMode"] : "FILL";
    const rotation = paramsObj["rotation"];
    const exposure = paramsObj["exposure"];
    const contrast = paramsObj["contrast"];
    const saturation = paramsObj["saturation"];
    const temperature = paramsObj["temperature"];
    const tint = paramsObj["tint"];
    const highlights = paramsObj["highlights"];
    const shadows = paramsObj["shadows"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!imageUrl) {
      throw new Error("Missing imageUrl parameter");
    }
    if (!/^https?:\/\//i.test(imageUrl)) {
      throw new Error("imageUrl must use http:// or https:// scheme");
    }
    const validScaleModes = ["FILL", "FIT", "CROP", "TILE"];
    if (!validScaleModes.includes(scaleMode)) {
      throw new Error(
        `Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(", ")}`
      );
    }
    debugLog(`setImageFill: Starting with nodeId=${nodeId}, imageUrl=${imageUrl}`);
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("fills" in node)) {
      throw new Error(`Node does not support fills: ${nodeId}`);
    }
    debugLog(`setImageFill: Found node "${node.name}", fetching image...`);
    let image;
    try {
      image = await figma.createImageAsync(imageUrl);
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(`setImageFill: Failed to fetch image: ${errorMsg}`);
      throw new Error(
        `Failed to fetch image. This may be due to CORS restrictions, an invalid URL, or an unsupported image format. Error: ${errorMsg}`
      );
    }
    debugLog(`setImageFill: Image fetched, hash=${image.hash}`);
    let width;
    let height;
    try {
      const size = await image.getSizeAsync();
      width = size.width;
      height = size.height;
    } catch (sizeError) {
      console.error(`setImageFill: Failed to get image size: ${sizeError}`);
      width = 0;
      height = 0;
    }
    debugLog(`setImageFill: Image size ${width}x${height}`);
    const hasFilters = exposure !== void 0 || contrast !== void 0 || saturation !== void 0 || temperature !== void 0 || tint !== void 0 || highlights !== void 0 || shadows !== void 0;
    const imageFilters = hasFilters ? __spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({}, exposure !== void 0 ? { exposure } : {}), contrast !== void 0 ? { contrast } : {}), saturation !== void 0 ? { saturation } : {}), temperature !== void 0 ? { temperature } : {}), tint !== void 0 ? { tint } : {}), highlights !== void 0 ? { highlights } : {}), shadows !== void 0 ? { shadows } : {}) : void 0;
    const imagePaint = __spreadValues(__spreadValues({
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode
    }, rotation !== void 0 && ["TILE", "FILL", "FIT"].includes(scaleMode) ? { rotation } : {}), imageFilters !== void 0 ? { filters: imageFilters } : {});
    try {
      node.fills = [imagePaint];
    } catch (fillError) {
      const errorMsg = fillError instanceof Error ? fillError.message : String(fillError);
      console.error(`setImageFill: Failed to apply fill: ${errorMsg}`);
      throw new Error(`Failed to apply image fill to node: ${errorMsg}`);
    }
    debugLog("setImageFill: Successfully applied image fill");
    return {
      id: node.id,
      name: node.name,
      imageHash: image.hash,
      imageSize: { width, height },
      scaleMode,
      fills: [imagePaint]
    };
  }
  async function setGradientFill(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const nodeId = paramsObj["nodeId"];
    const gradientType = paramsObj["gradientType"];
    const gradientStops = paramsObj["gradientStops"];
    const angle = paramsObj["angle"] !== void 0 ? paramsObj["angle"] : 0;
    const opacity = paramsObj["opacity"] !== void 0 ? paramsObj["opacity"] : 1;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!gradientType) {
      throw new Error("Missing gradientType parameter");
    }
    const validTypes = ["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"];
    if (!validTypes.includes(gradientType)) {
      throw new Error(
        `Invalid gradientType: ${gradientType}. Must be one of: ${validTypes.join(", ")}`
      );
    }
    if (!gradientStops || !Array.isArray(gradientStops) || gradientStops.length < 2) {
      throw new Error("gradientStops must be an array with at least 2 stops");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("fills" in node)) {
      throw new Error(`Node does not support fills: ${nodeId}`);
    }
    const figmaStops = gradientStops.map((stop) => {
      const stopColor = stop["color"];
      return {
        color: {
          r: stopColor["r"],
          g: stopColor["g"],
          b: stopColor["b"],
          a: stopColor["a"] !== void 0 ? stopColor["a"] : 1
        },
        position: stop["position"]
      };
    });
    const angleRad = angle * Math.PI / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const cx = 0.5;
    const cy = 0.5;
    const startX = cx - cos * 0.5;
    const startY = cy - sin * 0.5;
    let gradientTransform;
    if (gradientType === "LINEAR") {
      gradientTransform = [
        [cos, sin, startX],
        [-sin, cos, startY]
      ];
    } else {
      gradientTransform = [
        [1, 0, 0],
        [0, 1, 0]
      ];
    }
    const gradientPaint = {
      type: `GRADIENT_${gradientType}`,
      gradientStops: figmaStops,
      gradientTransform,
      opacity
    };
    node.fills = [gradientPaint];
    return {
      id: node.id,
      name: node.name,
      gradientType,
      stopsCount: figmaStops.length
    };
  }

  // src/claude_mcp_plugin/utils/color.ts
  function svgColorToFigmaRgb(colorStr) {
    if (!colorStr) return { r: 0, g: 0, b: 0 };
    const s = colorStr.trim().toLowerCase();
    if (s.charAt(0) === "#") {
      let hex = s.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255
      };
    }
    const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1]) / 255,
        g: parseInt(rgbMatch[2]) / 255,
        b: parseInt(rgbMatch[3]) / 255
      };
    }
    const named = {
      black: { r: 0, g: 0, b: 0 },
      white: { r: 1, g: 1, b: 1 },
      red: { r: 1, g: 0, b: 0 },
      green: { r: 0, g: 0.5, b: 0 },
      blue: { r: 0, g: 0, b: 1 },
      gray: { r: 0.5, g: 0.5, b: 0.5 },
      grey: { r: 0.5, g: 0.5, b: 0.5 }
    };
    return named[s] !== void 0 ? named[s] : { r: 0, g: 0, b: 0 };
  }
  function formatVariableValue(value, type) {
    if (type === "COLOR" && value !== null && value !== void 0 && typeof value === "object" && "r" in value) {
      const colorValue = value;
      return {
        r: colorValue.r,
        g: colorValue.g,
        b: colorValue.b,
        a: colorValue.a !== void 0 ? colorValue.a : 1
      };
    }
    return value;
  }

  // src/claude_mcp_plugin/utils/svg.ts
  function parseSvgRootStroke(svgString) {
    const tagMatch = svgString.match(/<svg(\s[^>]*)?>/i);
    if (!tagMatch || !tagMatch[1]) return null;
    const svgAttrs = tagMatch[1];
    const strokeMatch = svgAttrs.match(/\bstroke\s*=\s*"([^"]*)"/);
    if (!strokeMatch || strokeMatch[1] === "none" || strokeMatch[1] === "") {
      return null;
    }
    const strokeWidthMatch = svgAttrs.match(/\bstroke-width\s*=\s*"([^"]*)"/);
    const strokeOpacityMatch = svgAttrs.match(/\bstroke-opacity\s*=\s*"([^"]*)"/);
    return {
      color: strokeMatch[1],
      width: strokeWidthMatch ? parseFloat(strokeWidthMatch[1]) : 1,
      opacity: strokeOpacityMatch ? parseFloat(strokeOpacityMatch[1]) : 1
    };
  }
  function propagateStrokeToShapes(node, strokeInfo) {
    const rgbColor = svgColorToFigmaRgb(strokeInfo.color);
    const strokePaint = {
      type: "SOLID",
      color: rgbColor,
      opacity: strokeInfo.opacity
    };
    _propagate(node, strokePaint, strokeInfo.width);
  }
  function _propagate(node, strokePaint, strokeWeight) {
    const shapeTypes = [
      "VECTOR",
      "BOOLEAN_OPERATION",
      "ELLIPSE",
      "STAR",
      "POLYGON",
      "LINE",
      "RECTANGLE"
    ];
    if (shapeTypes.indexOf(node.type) !== -1) {
      const strokeable = node;
      if (!strokeable.strokes || strokeable.strokes.length === 0) {
        strokeable.strokes = [strokePaint];
        if ("strokeWeight" in node) {
          node.strokeWeight = strokeWeight;
        }
      }
    }
    if ("children" in node) {
      const parent = node;
      for (let i = 0; i < parent.children.length; i++) {
        _propagate(parent.children[i], strokePaint, strokeWeight);
      }
    }
  }

  // src/claude_mcp_plugin/handlers/shapes.ts
  async function createEllipse(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const x = paramsObj["x"] !== void 0 ? paramsObj["x"] : 0;
    const y = paramsObj["y"] !== void 0 ? paramsObj["y"] : 0;
    const width = paramsObj["width"] !== void 0 ? paramsObj["width"] : 100;
    const height = paramsObj["height"] !== void 0 ? paramsObj["height"] : 100;
    const name = paramsObj["name"] !== void 0 ? paramsObj["name"] : "Ellipse";
    const parentId = paramsObj["parentId"];
    const fillColor = paramsObj["fillColor"] !== void 0 ? paramsObj["fillColor"] : { r: 0.8, g: 0.8, b: 0.8, a: 1 };
    const strokeColor = paramsObj["strokeColor"];
    const strokeWeight = paramsObj["strokeWeight"];
    const layoutPositioning = paramsObj["layoutPositioning"];
    const ellipse = figma.createEllipse();
    ellipse.name = name;
    ellipse.x = x;
    ellipse.y = y;
    ellipse.resize(width, height);
    if (fillColor) {
      const fillStyle = {
        type: "SOLID",
        color: {
          r: parseNum(fillColor["r"], 0),
          g: parseNum(fillColor["g"], 0),
          b: parseNum(fillColor["b"], 0)
        },
        opacity: parseNum(fillColor["a"], 1)
      };
      ellipse.fills = [fillStyle];
    }
    if (strokeColor) {
      const strokeStyle = {
        type: "SOLID",
        color: {
          r: parseNum(strokeColor["r"], 0),
          g: parseNum(strokeColor["g"], 0),
          b: parseNum(strokeColor["b"], 0)
        },
        opacity: parseNum(strokeColor["a"], 1)
      };
      ellipse.strokes = [strokeStyle];
      if (strokeWeight) {
        ellipse.strokeWeight = strokeWeight;
      }
    }
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(ellipse);
    } else {
      figma.currentPage.appendChild(ellipse);
    }
    if (layoutPositioning !== void 0) {
      ellipse.layoutPositioning = layoutPositioning;
      ellipse.x = x;
      ellipse.y = y;
    }
    return {
      id: ellipse.id,
      name: ellipse.name,
      type: ellipse.type,
      x: ellipse.x,
      y: ellipse.y,
      width: ellipse.width,
      height: ellipse.height
    };
  }
  async function createPolygon(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const x = paramsObj["x"] !== void 0 ? paramsObj["x"] : 0;
    const y = paramsObj["y"] !== void 0 ? paramsObj["y"] : 0;
    const width = paramsObj["width"] !== void 0 ? paramsObj["width"] : 100;
    const height = paramsObj["height"] !== void 0 ? paramsObj["height"] : 100;
    const sides = paramsObj["sides"] !== void 0 ? paramsObj["sides"] : 6;
    const name = paramsObj["name"] !== void 0 ? paramsObj["name"] : "Polygon";
    const parentId = paramsObj["parentId"];
    const fillColor = paramsObj["fillColor"];
    const strokeColor = paramsObj["strokeColor"];
    const strokeWeight = paramsObj["strokeWeight"];
    const polygon = figma.createPolygon();
    polygon.x = x;
    polygon.y = y;
    polygon.resize(width, height);
    polygon.name = name;
    if (sides >= 3) {
      polygon.pointCount = sides;
    }
    if (fillColor) {
      const paintStyle = {
        type: "SOLID",
        color: {
          r: parseNum(fillColor["r"], 0),
          g: parseNum(fillColor["g"], 0),
          b: parseNum(fillColor["b"], 0)
        },
        opacity: parseNum(fillColor["a"], 1)
      };
      polygon.fills = [paintStyle];
    }
    if (strokeColor) {
      const strokeStyle = {
        type: "SOLID",
        color: {
          r: parseNum(strokeColor["r"], 0),
          g: parseNum(strokeColor["g"], 0),
          b: parseNum(strokeColor["b"], 0)
        },
        opacity: parseNum(strokeColor["a"], 1)
      };
      polygon.strokes = [strokeStyle];
    }
    if (strokeWeight !== void 0) {
      polygon.strokeWeight = strokeWeight;
    }
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(polygon);
    } else {
      figma.currentPage.appendChild(polygon);
    }
    return {
      id: polygon.id,
      name: polygon.name,
      type: polygon.type,
      x: polygon.x,
      y: polygon.y,
      width: polygon.width,
      height: polygon.height,
      pointCount: polygon.pointCount,
      fills: polygon.fills,
      strokes: polygon.strokes,
      strokeWeight: polygon.strokeWeight,
      parentId: polygon.parent ? polygon.parent.id : void 0
    };
  }
  async function createStar(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const x = paramsObj["x"] !== void 0 ? paramsObj["x"] : 0;
    const y = paramsObj["y"] !== void 0 ? paramsObj["y"] : 0;
    const width = paramsObj["width"] !== void 0 ? paramsObj["width"] : 100;
    const height = paramsObj["height"] !== void 0 ? paramsObj["height"] : 100;
    const points = paramsObj["points"] !== void 0 ? paramsObj["points"] : 5;
    const innerRadius = paramsObj["innerRadius"] !== void 0 ? paramsObj["innerRadius"] : 0.5;
    const name = paramsObj["name"] !== void 0 ? paramsObj["name"] : "Star";
    const parentId = paramsObj["parentId"];
    const fillColor = paramsObj["fillColor"];
    const strokeColor = paramsObj["strokeColor"];
    const strokeWeight = paramsObj["strokeWeight"];
    const star = figma.createStar();
    star.x = x;
    star.y = y;
    star.resize(width, height);
    star.name = name;
    if (points >= 3) {
      star.pointCount = points;
    }
    if (innerRadius > 0 && innerRadius < 1) {
      star.innerRadius = innerRadius;
    }
    if (fillColor) {
      const paintStyle = {
        type: "SOLID",
        color: {
          r: parseNum(fillColor["r"], 0),
          g: parseNum(fillColor["g"], 0),
          b: parseNum(fillColor["b"], 0)
        },
        opacity: parseNum(fillColor["a"], 1)
      };
      star.fills = [paintStyle];
    }
    if (strokeColor) {
      const strokeStyle = {
        type: "SOLID",
        color: {
          r: parseNum(strokeColor["r"], 0),
          g: parseNum(strokeColor["g"], 0),
          b: parseNum(strokeColor["b"], 0)
        },
        opacity: parseNum(strokeColor["a"], 1)
      };
      star.strokes = [strokeStyle];
    }
    if (strokeWeight !== void 0) {
      star.strokeWeight = strokeWeight;
    }
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(star);
    } else {
      figma.currentPage.appendChild(star);
    }
    return {
      id: star.id,
      name: star.name,
      type: star.type,
      x: star.x,
      y: star.y,
      width: star.width,
      height: star.height,
      pointCount: star.pointCount,
      innerRadius: star.innerRadius,
      fills: star.fills,
      strokes: star.strokes,
      strokeWeight: star.strokeWeight,
      parentId: star.parent ? star.parent.id : void 0
    };
  }
  async function createSvg(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const svgString = paramsObj["svgString"];
    const x = paramsObj["x"] !== void 0 ? paramsObj["x"] : 0;
    const y = paramsObj["y"] !== void 0 ? paramsObj["y"] : 0;
    const name = paramsObj["name"];
    const parentId = paramsObj["parentId"];
    const flatten = paramsObj["flatten"] !== void 0 ? paramsObj["flatten"] : false;
    if (!svgString) {
      throw new Error("Missing svgString parameter");
    }
    const trimmedSvg = svgString.trim();
    if (!trimmedSvg.startsWith("<svg") && !trimmedSvg.startsWith("<?xml")) {
      throw new Error("Invalid SVG: must start with <svg or <?xml declaration");
    }
    debugLog(`createSvg: Creating SVG node, flatten=${flatten}`);
    let svgNode;
    try {
      svgNode = figma.createNodeFromSvg(svgString);
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      console.error(`createSvg: Failed to parse SVG: ${errorMsg}`);
      throw new Error(`Failed to parse SVG: ${errorMsg}`);
    }
    svgNode.x = x;
    svgNode.y = y;
    if (name) {
      svgNode.name = name;
    }
    const rootStroke = parseSvgRootStroke(svgString);
    if (rootStroke) {
      propagateStrokeToShapes(svgNode, rootStroke);
      if ("strokes" in svgNode) {
        svgNode.strokes = [];
      }
    }
    if (flatten && "children" in svgNode && svgNode.children.length > 0) {
      try {
        const flattened = figma.flatten([svgNode]);
        svgNode = flattened;
        if (name) {
          svgNode.name = name;
        }
        debugLog("createSvg: Flattened SVG to single vector");
      } catch (flattenError) {
        console.warn(`createSvg: Could not flatten SVG: ${flattenError}`);
      }
    }
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(svgNode);
      const parentFrame = parentNode;
      if (parentFrame.name && parentFrame.name.indexOf("Icon/") === 0) {
        parentFrame.strokes = [];
        parentFrame.strokeWeight = 0;
        parentFrame.strokeTopWeight = 0;
        parentFrame.strokeBottomWeight = 0;
        parentFrame.strokeLeftWeight = 0;
        parentFrame.strokeRightWeight = 0;
        const parentW = parentFrame.width !== void 0 ? parentFrame.width : 0;
        const parentH = parentFrame.height !== void 0 ? parentFrame.height : 0;
        if (parentW > 0 && parentH > 0 && svgNode.resize) {
          svgNode.resize(parentW, parentH);
          svgNode.x = 0;
          svgNode.y = 0;
        }
      }
    } else {
      figma.currentPage.appendChild(svgNode);
    }
    debugLog(`createSvg: Created SVG node "${svgNode.name}" (${svgNode.id})`);
    return {
      id: svgNode.id,
      name: svgNode.name,
      type: svgNode.type,
      x: svgNode.x,
      y: svgNode.y,
      width: svgNode.width,
      height: svgNode.height,
      childCount: "children" in svgNode ? svgNode.children.length : 0,
      parentId: svgNode.parent ? svgNode.parent.id : void 0
    };
  }
  async function createVector(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const x = paramsObj["x"] !== void 0 ? paramsObj["x"] : 0;
    const y = paramsObj["y"] !== void 0 ? paramsObj["y"] : 0;
    const width = paramsObj["width"] !== void 0 ? paramsObj["width"] : 100;
    const height = paramsObj["height"] !== void 0 ? paramsObj["height"] : 100;
    const name = paramsObj["name"] !== void 0 ? paramsObj["name"] : "Vector";
    const parentId = paramsObj["parentId"];
    const vectorPaths = paramsObj["vectorPaths"] !== void 0 ? paramsObj["vectorPaths"] : [];
    const fillColor = paramsObj["fillColor"];
    const strokeColor = paramsObj["strokeColor"];
    const strokeWeight = paramsObj["strokeWeight"];
    const vector = figma.createVector();
    vector.x = x;
    vector.y = y;
    vector.resize(width, height);
    vector.name = name;
    if (vectorPaths && vectorPaths.length > 0) {
      vector.vectorPaths = vectorPaths.map((path) => {
        return {
          windingRule: path["windingRule"] !== void 0 ? path["windingRule"] : "EVENODD",
          data: path["data"] !== void 0 ? path["data"] : ""
        };
      });
    }
    if (fillColor) {
      const paintStyle = {
        type: "SOLID",
        color: {
          r: parseNum(fillColor["r"], 0),
          g: parseNum(fillColor["g"], 0),
          b: parseNum(fillColor["b"], 0)
        },
        opacity: parseNum(fillColor["a"], 1)
      };
      vector.fills = [paintStyle];
    }
    if (strokeColor) {
      const strokeStyle = {
        type: "SOLID",
        color: {
          r: parseNum(strokeColor["r"], 0),
          g: parseNum(strokeColor["g"], 0),
          b: parseNum(strokeColor["b"], 0)
        },
        opacity: parseNum(strokeColor["a"], 1)
      };
      vector.strokes = [strokeStyle];
    }
    if (strokeWeight !== void 0) {
      vector.strokeWeight = strokeWeight;
    }
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(vector);
    } else {
      figma.currentPage.appendChild(vector);
    }
    return {
      id: vector.id,
      name: vector.name,
      type: vector.type,
      x: vector.x,
      y: vector.y,
      width: vector.width,
      height: vector.height,
      vectorNetwork: vector.vectorNetwork,
      fills: vector.fills,
      strokes: vector.strokes,
      strokeWeight: vector.strokeWeight,
      parentId: vector.parent ? vector.parent.id : void 0
    };
  }
  async function createLine(params) {
    const paramsObj = params !== null && params !== void 0 ? params : {};
    const x1 = paramsObj["x1"] !== void 0 ? paramsObj["x1"] : 0;
    const y1 = paramsObj["y1"] !== void 0 ? paramsObj["y1"] : 0;
    const x2 = paramsObj["x2"] !== void 0 ? paramsObj["x2"] : 100;
    const y2 = paramsObj["y2"] !== void 0 ? paramsObj["y2"] : 0;
    const name = paramsObj["name"] !== void 0 ? paramsObj["name"] : "Line";
    const parentId = paramsObj["parentId"];
    const strokeColor = paramsObj["strokeColor"] !== void 0 ? paramsObj["strokeColor"] : { r: 0, g: 0, b: 0, a: 1 };
    const strokeWeight = paramsObj["strokeWeight"] !== void 0 ? paramsObj["strokeWeight"] : 1;
    const strokeCap = paramsObj["strokeCap"] !== void 0 ? paramsObj["strokeCap"] : "NONE";
    const line = figma.createVector();
    line.name = name;
    line.x = x1;
    line.y = y1;
    const lineWidth = Math.abs(x2 - x1);
    const lineHeight = Math.abs(y2 - y1);
    line.resize(lineWidth > 0 ? lineWidth : 1, lineHeight > 0 ? lineHeight : 1);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const endX = dx > 0 ? lineWidth : 0;
    const endY = dy > 0 ? lineHeight : 0;
    const startX = dx > 0 ? 0 : lineWidth;
    const startY = dy > 0 ? 0 : lineHeight;
    const pathData = `M ${startX} ${startY} L ${endX} ${endY}`;
    line.vectorPaths = [
      {
        windingRule: "NONZERO",
        data: pathData
      }
    ];
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseNum(strokeColor["r"], 0),
        g: parseNum(strokeColor["g"], 0),
        b: parseNum(strokeColor["b"], 0)
      },
      opacity: parseNum(strokeColor["a"], 1)
    };
    line.strokes = [strokeStyle];
    line.strokeWeight = strokeWeight;
    const validStrokeCaps = ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"];
    if (validStrokeCaps.includes(strokeCap)) {
      line.strokeCap = strokeCap;
    }
    line.fills = [];
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(line);
    } else {
      figma.currentPage.appendChild(line);
    }
    return {
      id: line.id,
      name: line.name,
      type: line.type,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      strokeWeight: line.strokeWeight,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      strokeCap: line.strokeCap,
      strokes: line.strokes,
      vectorPaths: line.vectorPaths,
      parentId: line.parent ? line.parent.id : void 0
    };
  }

  // src/claude_mcp_plugin/handlers/icons.ts
  async function updateIcon(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const svgString = params !== null && params !== void 0 ? params["svgString"] : void 0;
    const name = params !== null && params !== void 0 ? params["name"] : void 0;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!svgString) {
      throw new Error("Missing svgString parameter");
    }
    const trimmedSvg = svgString.trim();
    if (trimmedSvg.indexOf("<svg") !== 0 && trimmedSvg.indexOf("<?xml") !== 0) {
      throw new Error("Invalid SVG: must start with <svg or <?xml declaration");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error("Node not found with ID: " + nodeId);
    }
    const parent = node.parent;
    if (!parent) {
      throw new Error("Node has no parent");
    }
    if (!("insertChild" in parent) && !("appendChild" in parent)) {
      throw new Error("Parent node does not support child insertion");
    }
    let index = -1;
    if ("children" in parent) {
      const children = parent.children;
      for (let i = 0; i < children.length; i++) {
        if (children[i].id === nodeId) {
          index = i;
          break;
        }
      }
    }
    const sceneNode = node;
    const origX = "x" in sceneNode && sceneNode.x !== void 0 ? sceneNode.x : 0;
    const origY = "y" in sceneNode && sceneNode.y !== void 0 ? sceneNode.y : 0;
    node.remove();
    let svgNode = figma.createNodeFromSvg(svgString);
    svgNode.x = origX;
    svgNode.y = origY;
    if (name) {
      svgNode.name = name;
    }
    const rootStroke = parseSvgRootStroke(svgString);
    if (rootStroke) {
      propagateStrokeToShapes(svgNode, rootStroke);
      if ("strokes" in svgNode) {
        svgNode.strokes = [];
      }
    }
    debugLog("updateIcon: inserting replacement SVG node");
    if ("insertChild" in parent && index >= 0) {
      parent.insertChild(
        index,
        svgNode
      );
    } else {
      parent.appendChild(svgNode);
    }
    const parentNode = parent;
    if (parentNode.name && parentNode.name.indexOf("Icon/") === 0) {
      if ("strokes" in parent) {
        parent.strokes = [];
      }
      const parentLayout = parent;
      const parentW = parentLayout.width !== void 0 ? parentLayout.width : 0;
      const parentH = parentLayout.height !== void 0 ? parentLayout.height : 0;
      if (parentW > 0 && parentH > 0 && "resize" in svgNode) {
        svgNode.resize(
          parentW,
          parentH
        );
        svgNode.x = 0;
        svgNode.y = 0;
      }
    }
    return {
      id: svgNode.id,
      name: svgNode.name,
      parentId: svgNode.parent !== null && svgNode.parent !== void 0 ? svgNode.parent.id : void 0,
      index
    };
  }

  // src/claude_mcp_plugin/handlers/text.ts
  var getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
    const indices = [];
    let temp = startIdx;
    for (let i = startIdx; i < endIdx; i++) {
      if (str[i] === delimiter && i + startIdx !== endIdx && temp !== i + startIdx) {
        indices.push([temp, i + startIdx]);
        temp = i + startIdx + 1;
      }
    }
    if (temp !== endIdx) {
      indices.push([temp, endIdx]);
    }
    return indices.filter(Boolean);
  };
  var buildLinearOrder = (node) => {
    const fontTree = [];
    const newLinesPos = getDelimiterPos(node.characters, "\n");
    newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd]) => {
      const newLinesRangeFont = node.getRangeFontName(
        newLinesRangeStart,
        newLinesRangeEnd
      );
      if (newLinesRangeFont === figma.mixed) {
        const spacesPos = getDelimiterPos(
          node.characters,
          " ",
          newLinesRangeStart,
          newLinesRangeEnd
        );
        spacesPos.forEach(([spacesRangeStart, spacesRangeEnd]) => {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeEnd
          );
          if (spacesRangeFont === figma.mixed) {
            const firstCharFont = node.getRangeFontName(
              spacesRangeStart,
              spacesRangeStart + 1
            );
            fontTree.push({
              start: spacesRangeStart,
              delimiter: " ",
              family: firstCharFont.family,
              style: firstCharFont.style
            });
          } else {
            fontTree.push({
              start: spacesRangeStart,
              delimiter: " ",
              family: spacesRangeFont.family,
              style: spacesRangeFont.style
            });
          }
        });
      } else {
        fontTree.push({
          start: newLinesRangeStart,
          delimiter: "\n",
          family: newLinesRangeFont.family,
          style: newLinesRangeFont.style
        });
      }
    });
    return fontTree.sort((a, b) => +a.start - +b.start).map(({ family, style, delimiter }) => ({ family, style, delimiter }));
  };
  var setCharactersWithStrictMatchFont = async (node, characters, fallbackFont) => {
    const fontHashTree = {};
    for (let i = 1; i < node.characters.length; i++) {
      const startIdx = i - 1;
      const startCharFont = node.getRangeFontName(startIdx, i);
      const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
      while (i < node.characters.length) {
        i++;
        const charFont = node.getRangeFontName(i - 1, i);
        if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
          break;
        }
      }
      fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
    }
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
    node.characters = characters;
    debugLog(fontHashTree);
    await Promise.all(
      Object.keys(fontHashTree).map(async (range) => {
        debugLog(range, fontHashTree[range]);
        const [start, end] = range.split("_");
        const [family, style] = fontHashTree[range].split("::");
        const matchedFont = { family, style };
        await figma.loadFontAsync(matchedFont);
        return node.setRangeFontName(Number(start), Number(end), matchedFont);
      })
    );
    return true;
  };
  var setCharactersWithSmartMatchFont = async (node, characters, fallbackFont) => {
    const rangeTree = buildLinearOrder(node);
    const fontsToLoad = uniqBy(
      rangeTree,
      ({ family, style }) => `${family}::${style}`
    ).map(({ family, style }) => ({
      family,
      style
    }));
    await Promise.all(
      [...fontsToLoad, fallbackFont].map((f) => figma.loadFontAsync(f))
    );
    node.fontName = fallbackFont;
    node.characters = characters;
    let prevPos = 0;
    rangeTree.forEach(
      ({ family, style, delimiter }) => {
        if (prevPos < node.characters.length) {
          const delimeterPos = node.characters.indexOf(delimiter, prevPos);
          const endPos = delimeterPos > prevPos ? delimeterPos : node.characters.length;
          const matchedFont = { family, style };
          node.setRangeFontName(prevPos, endPos, matchedFont);
          prevPos = endPos + 1;
        }
      }
    );
    return true;
  };
  var setCharacters = async (node, characters, options) => {
    const fallbackFont = options !== null && options !== void 0 && options.fallbackFont !== null && options.fallbackFont !== void 0 ? options.fallbackFont : { family: "Inter", style: "Regular" };
    try {
      if (node.fontName === figma.mixed) {
        const smartStrategy = options !== null && options !== void 0 ? options.smartStrategy : void 0;
        if (smartStrategy === "prevail") {
          const fontHashTree = {};
          for (let i = 1; i < node.characters.length; i++) {
            const charFont = node.getRangeFontName(i - 1, i);
            const key = `${charFont.family}::${charFont.style}`;
            fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
          }
          const prevailedTreeItem = Object.entries(fontHashTree).sort(
            (a, b) => b[1] - a[1]
          )[0];
          const [family, style] = prevailedTreeItem[0].split("::");
          const prevailedFont = { family, style };
          await figma.loadFontAsync(prevailedFont);
          node.fontName = prevailedFont;
        } else if (smartStrategy === "strict") {
          return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
        } else if (smartStrategy === "experimental") {
          return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
        } else {
          const firstCharFont = node.getRangeFontName(0, 1);
          await figma.loadFontAsync(firstCharFont);
          node.fontName = firstCharFont;
        }
      } else {
        await figma.loadFontAsync({
          family: node.fontName.family,
          style: node.fontName.style
        });
      }
    } catch (err) {
      const fontFamily = typeof node.fontName === "object" && "family" in node.fontName ? node.fontName.family : "";
      const fontStyle = typeof node.fontName === "object" && "style" in node.fontName ? node.fontName.style : "";
      console.warn(
        `Failed to load "${fontFamily} ${fontStyle}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
        err
      );
      await figma.loadFontAsync(fallbackFont);
      node.fontName = fallbackFont;
    }
    try {
      node.characters = characters;
      return true;
    } catch (err) {
      console.warn("Failed to set characters. Skipped.", err);
      return false;
    }
  };
  async function createText(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const x = safeParams.x !== void 0 ? safeParams.x : 0;
    const y = safeParams.y !== void 0 ? safeParams.y : 0;
    const text = safeParams.text !== void 0 ? safeParams.text : "Text";
    const fontSize = safeParams.fontSize !== void 0 ? safeParams.fontSize : 14;
    const fontFamily = safeParams.fontFamily !== void 0 ? safeParams.fontFamily : "Inter";
    const fontWeight = safeParams.fontWeight !== void 0 ? safeParams.fontWeight : 400;
    const fontColor = safeParams.fontColor !== null && safeParams.fontColor !== void 0 ? safeParams.fontColor : { r: 0, g: 0, b: 0, a: 1 };
    const name = safeParams.name !== void 0 ? safeParams.name : "Text";
    const parentId = safeParams.parentId !== void 0 ? safeParams.parentId : void 0;
    const textNode = figma.createText();
    textNode.x = x;
    textNode.y = y;
    textNode.name = name;
    try {
      await figma.loadFontAsync({
        family: fontFamily,
        style: getFontStyle(fontWeight)
      });
      textNode.fontName = { family: fontFamily, style: getFontStyle(fontWeight) };
      textNode.fontSize = parseInt(String(fontSize));
    } catch (error) {
      console.error("Error setting font name/size", error);
    }
    await setCharacters(textNode, text);
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseNum(fontColor.r, 0),
        g: parseNum(fontColor.g, 0),
        b: parseNum(fontColor.b, 0)
      },
      opacity: parseNum(fontColor.a, 1)
    };
    textNode.fills = [paintStyle];
    if (parentId !== null && parentId !== void 0) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        throw new Error(`Parent node not found with ID: ${parentId}`);
      }
      if (!("appendChild" in parentNode)) {
        throw new Error(`Parent node does not support children: ${parentId}`);
      }
      parentNode.appendChild(textNode);
    } else {
      figma.currentPage.appendChild(textNode);
    }
    return {
      id: textNode.id,
      name: textNode.name,
      x: textNode.x,
      y: textNode.y,
      width: textNode.width,
      height: textNode.height,
      characters: textNode.characters,
      fontSize: textNode.fontSize,
      fontWeight,
      fontColor,
      fontName: textNode.fontName,
      fills: textNode.fills,
      parentId: textNode.parent ? textNode.parent.id : void 0
    };
  }
  async function setTextContent(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const text = safeParams.text;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (text === void 0) {
      throw new Error("Missing text parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      await figma.loadFontAsync(node.fontName);
      await setCharacters(node, text);
      return {
        id: node.id,
        name: node.name,
        characters: node.characters,
        fontName: node.fontName
      };
    } catch (error) {
      throw new Error(`Error setting text content: ${error.message}`);
    }
  }
  async function collectNodesToProcess(node, parentPath = [], depth = 0, nodesToProcess = []) {
    if (node.visible === false) return;
    const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];
    nodesToProcess.push({ node, parentPath: nodePath, depth });
    if ("children" in node) {
      for (const child of node.children) {
        await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess);
      }
    }
  }
  async function processTextNode(node, parentPath, depth) {
    if (node.type !== "TEXT") return null;
    const textNode = node;
    try {
      let fontFamily = "";
      let fontStyle = "";
      if (textNode.fontName) {
        if (typeof textNode.fontName === "object") {
          if ("family" in textNode.fontName) fontFamily = textNode.fontName.family;
          if ("style" in textNode.fontName) fontStyle = textNode.fontName.style;
        }
      }
      const safeTextNode = {
        id: textNode.id,
        name: textNode.name || "Text",
        type: textNode.type,
        characters: textNode.characters,
        fontSize: typeof textNode.fontSize === "number" ? textNode.fontSize : 0,
        fontFamily,
        fontStyle,
        x: typeof textNode.x === "number" ? textNode.x : 0,
        y: typeof textNode.y === "number" ? textNode.y : 0,
        width: typeof textNode.width === "number" ? textNode.width : 0,
        height: typeof textNode.height === "number" ? textNode.height : 0,
        path: parentPath.join(" > "),
        depth
      };
      try {
        const originalFills = JSON.parse(JSON.stringify(textNode.fills));
        textNode.fills = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 },
            opacity: 0.3
          }
        ];
        await delay(100);
        try {
          textNode.fills = originalFills;
        } catch (err) {
          console.error("Error resetting fills:", err);
        }
      } catch (highlightErr) {
        console.error("Error highlighting text node:", highlightErr);
      }
      return safeTextNode;
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      return null;
    }
  }
  async function findTextNodes(node, parentPath = [], depth = 0, textNodes = []) {
    if (node.visible === false) return;
    const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];
    if (node.type === "TEXT") {
      const textNode = node;
      try {
        let fontFamily = "";
        let fontStyle = "";
        if (textNode.fontName) {
          if (typeof textNode.fontName === "object") {
            if ("family" in textNode.fontName) fontFamily = textNode.fontName.family;
            if ("style" in textNode.fontName) fontStyle = textNode.fontName.style;
          }
        }
        const safeTextNode = {
          id: textNode.id,
          name: textNode.name || "Text",
          type: textNode.type,
          characters: textNode.characters,
          fontSize: typeof textNode.fontSize === "number" ? textNode.fontSize : 0,
          fontFamily,
          fontStyle,
          x: typeof textNode.x === "number" ? textNode.x : 0,
          y: typeof textNode.y === "number" ? textNode.y : 0,
          width: typeof textNode.width === "number" ? textNode.width : 0,
          height: typeof textNode.height === "number" ? textNode.height : 0,
          path: nodePath.join(" > "),
          depth
        };
        try {
          const originalFills = JSON.parse(JSON.stringify(textNode.fills));
          textNode.fills = [
            {
              type: "SOLID",
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3
            }
          ];
          await delay(500);
          try {
            textNode.fills = originalFills;
          } catch (err) {
            console.error("Error resetting fills:", err);
          }
        } catch (highlightErr) {
          console.error("Error highlighting text node:", highlightErr);
        }
        textNodes.push(safeTextNode);
      } catch (nodeErr) {
        console.error("Error processing text node:", nodeErr);
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        await findTextNodes(child, nodePath, depth + 1, textNodes);
      }
    }
  }
  async function scanTextNodes(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const useChunking = safeParams.useChunking !== void 0 ? safeParams.useChunking : true;
    const chunkSize = safeParams.chunkSize !== void 0 ? safeParams.chunkSize : 10;
    const commandId = safeParams.commandId !== null && safeParams.commandId !== void 0 ? safeParams.commandId : generateCommandId();
    debugLog(`Starting to scan text nodes from node ID: ${nodeId}`);
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      console.error(`Node with ID ${nodeId} not found`);
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "error",
        0,
        0,
        0,
        `Node with ID ${nodeId} not found`,
        { error: `Node not found: ${nodeId}` }
      );
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (!useChunking) {
      const textNodes = [];
      try {
        sendProgressUpdate(
          commandId,
          "scan_text_nodes",
          "started",
          0,
          1,
          0,
          `Starting scan of node "${node.name || nodeId}" without chunking`,
          null
        );
        await findTextNodes(node, [], 0, textNodes);
        sendProgressUpdate(
          commandId,
          "scan_text_nodes",
          "completed",
          100,
          textNodes.length,
          textNodes.length,
          `Scan complete. Found ${textNodes.length} text nodes.`,
          { textNodes }
        );
        return {
          success: true,
          message: `Scanned ${textNodes.length} text nodes.`,
          count: textNodes.length,
          textNodes,
          commandId
        };
      } catch (error) {
        console.error("Error scanning text nodes:", error);
        sendProgressUpdate(
          commandId,
          "scan_text_nodes",
          "error",
          0,
          0,
          0,
          `Error scanning text nodes: ${error.message}`,
          { error: error.message }
        );
        throw new Error(`Error scanning text nodes: ${error.message}`);
      }
    }
    debugLog(`Using chunked scanning with chunk size: ${chunkSize}`);
    const nodesToProcess = [];
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "started",
      0,
      0,
      0,
      `Starting chunked scan of node "${node.name || nodeId}"`,
      { chunkSize }
    );
    await collectNodesToProcess(node, [], 0, nodesToProcess);
    const totalNodes = nodesToProcess.length;
    debugLog(`Found ${totalNodes} total nodes to process`);
    const totalChunks = Math.ceil(totalNodes / chunkSize);
    debugLog(`Will process in ${totalChunks} chunks`);
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      5,
      totalNodes,
      0,
      `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
      { totalNodes, totalChunks, chunkSize }
    );
    const allTextNodes = [];
    let processedNodes = 0;
    let chunksProcessed = 0;
    for (let i = 0; i < totalNodes; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, totalNodes);
      debugLog(
        `Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${chunkEnd - 1})`
      );
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "in_progress",
        Math.round(5 + chunksProcessed / totalChunks * 90),
        totalNodes,
        processedNodes,
        `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
        {
          currentChunk: chunksProcessed + 1,
          totalChunks,
          textNodesFound: allTextNodes.length
        }
      );
      const chunkNodes = nodesToProcess.slice(i, chunkEnd);
      const chunkTextNodes = [];
      for (const nodeInfo of chunkNodes) {
        if (nodeInfo.node.type === "TEXT") {
          try {
            const textNodeInfo = await processTextNode(
              nodeInfo.node,
              nodeInfo.parentPath,
              nodeInfo.depth
            );
            if (textNodeInfo) {
              chunkTextNodes.push(textNodeInfo);
            }
          } catch (error) {
            console.error(`Error processing text node: ${error.message}`);
          }
        }
        await delay(5);
      }
      allTextNodes.push(...chunkTextNodes);
      processedNodes += chunkNodes.length;
      chunksProcessed++;
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "in_progress",
        Math.round(5 + chunksProcessed / totalChunks * 90),
        totalNodes,
        processedNodes,
        `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
        {
          currentChunk: chunksProcessed,
          totalChunks,
          processedNodes,
          textNodesFound: allTextNodes.length,
          chunkResult: chunkTextNodes
        }
      );
      if (i + chunkSize < totalNodes) {
        await delay(50);
      }
    }
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "completed",
      100,
      totalNodes,
      processedNodes,
      `Scan complete. Found ${allTextNodes.length} text nodes.`,
      { textNodes: allTextNodes, processedNodes, chunks: chunksProcessed }
    );
    return {
      success: true,
      message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
      totalNodes: allTextNodes.length,
      processedNodes,
      chunks: chunksProcessed,
      textNodes: allTextNodes,
      commandId
    };
  }
  async function setMultipleTextContents(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const text = safeParams.text;
    const commandId = safeParams.commandId !== null && safeParams.commandId !== void 0 ? safeParams.commandId : generateCommandId();
    if (!nodeId || !text || !Array.isArray(text)) {
      const errorMsg = "Missing required parameters: nodeId and text array";
      sendProgressUpdate(
        commandId,
        "set_multiple_text_contents",
        "error",
        0,
        0,
        0,
        errorMsg,
        { error: errorMsg }
      );
      throw new Error(errorMsg);
    }
    debugLog(
      `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`
    );
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "started",
      0,
      text.length,
      0,
      `Starting text replacement for ${text.length} nodes`,
      { totalReplacements: text.length }
    );
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    const CHUNK_SIZE = 5;
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      chunks.push(text.slice(i, i + CHUNK_SIZE));
    }
    debugLog(`Split ${text.length} replacements into ${chunks.length} chunks`);
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      5,
      text.length,
      0,
      `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
      {
        totalReplacements: text.length,
        chunks: chunks.length,
        chunkSize: CHUNK_SIZE
      }
    );
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      debugLog(
        `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} replacements`
      );
      sendProgressUpdate(
        commandId,
        "set_multiple_text_contents",
        "in_progress",
        Math.round(5 + chunkIndex / chunks.length * 90),
        text.length,
        successCount + failureCount,
        `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
        {
          currentChunk: chunkIndex + 1,
          totalChunks: chunks.length,
          successCount,
          failureCount
        }
      );
      const chunkPromises = chunk.map(async (replacement) => {
        if (!replacement.nodeId || replacement.text === void 0) {
          console.error("Missing nodeId or text for replacement");
          return {
            success: false,
            nodeId: replacement.nodeId !== null && replacement.nodeId !== void 0 ? replacement.nodeId : "unknown",
            error: "Missing nodeId or text in replacement entry"
          };
        }
        try {
          debugLog(`Attempting to replace text in node: ${replacement.nodeId}`);
          const textNode = await figma.getNodeByIdAsync(replacement.nodeId);
          if (!textNode) {
            console.error(`Text node not found: ${replacement.nodeId}`);
            return {
              success: false,
              nodeId: replacement.nodeId,
              error: `Node not found: ${replacement.nodeId}`
            };
          }
          if (textNode.type !== "TEXT") {
            console.error(
              `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`
            );
            return {
              success: false,
              nodeId: replacement.nodeId,
              error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`
            };
          }
          const originalText = textNode.characters;
          debugLog(`Original text: "${originalText}"`);
          debugLog(`Will translate to: "${replacement.text}"`);
          let originalFills;
          try {
            originalFills = JSON.parse(
              JSON.stringify(textNode.fills)
            );
            textNode.fills = [
              {
                type: "SOLID",
                color: { r: 1, g: 0.5, b: 0 },
                opacity: 0.3
              }
            ];
          } catch (highlightErr) {
            console.error(
              `Error highlighting text node: ${highlightErr.message}`
            );
          }
          await setTextContent({
            nodeId: replacement.nodeId,
            text: replacement.text
          });
          if (originalFills !== null && originalFills !== void 0) {
            try {
              await delay(500);
              textNode.fills = originalFills;
            } catch (restoreErr) {
              console.error(
                `Error restoring fills: ${restoreErr.message}`
              );
            }
          }
          debugLog(
            `Successfully replaced text in node: ${replacement.nodeId}`
          );
          return {
            success: true,
            nodeId: replacement.nodeId,
            originalText,
            translatedText: replacement.text
          };
        } catch (error) {
          console.error(
            `Error replacing text in node ${replacement.nodeId}: ${error.message}`
          );
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Error applying replacement: ${error.message}`
          };
        }
      });
      const chunkResults = await Promise.all(chunkPromises);
      chunkResults.forEach((result) => {
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }
        results.push(result);
      });
      sendProgressUpdate(
        commandId,
        "set_multiple_text_contents",
        "in_progress",
        Math.round(5 + (chunkIndex + 1) / chunks.length * 90),
        text.length,
        successCount + failureCount,
        `Completed chunk ${chunkIndex + 1}/${chunks.length}. ${successCount} successful, ${failureCount} failed so far.`,
        {
          currentChunk: chunkIndex + 1,
          totalChunks: chunks.length,
          successCount,
          failureCount,
          chunkResults
        }
      );
      if (chunkIndex < chunks.length - 1) {
        debugLog("Pausing between chunks to avoid overloading Figma...");
        await delay(1e3);
      }
    }
    debugLog(
      `Replacement complete: ${successCount} successful, ${failureCount} failed`
    );
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "completed",
      100,
      text.length,
      successCount + failureCount,
      `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
      {
        totalReplacements: text.length,
        replacementsApplied: successCount,
        replacementsFailed: failureCount,
        completedInChunks: chunks.length,
        results
      }
    );
    return {
      success: successCount > 0,
      nodeId,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      totalReplacements: text.length,
      results,
      completedInChunks: chunks.length,
      commandId
    };
  }
  async function setAutoLayout(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const layoutMode = safeParams.layoutMode;
    const paddingTop = safeParams.paddingTop;
    const paddingBottom = safeParams.paddingBottom;
    const paddingLeft = safeParams.paddingLeft;
    const paddingRight = safeParams.paddingRight;
    const itemSpacing = safeParams.itemSpacing;
    const primaryAxisAlignItems = safeParams.primaryAxisAlignItems;
    const counterAxisAlignItems = safeParams.counterAxisAlignItems;
    const layoutWrap = safeParams.layoutWrap;
    const strokesIncludedInLayout = safeParams.strokesIncludedInLayout;
    const clipsContent = safeParams.clipsContent;
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!layoutMode) {
      throw new Error("Missing layoutMode parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("layoutMode" in node)) {
      throw new Error(`Node does not support auto layout: ${nodeId}`);
    }
    const frameNode = node;
    if (layoutMode === "NONE") {
      frameNode.layoutMode = "NONE";
    } else {
      frameNode.layoutMode = layoutMode;
      if (paddingTop !== void 0) frameNode.paddingTop = paddingTop;
      if (paddingBottom !== void 0) frameNode.paddingBottom = paddingBottom;
      if (paddingLeft !== void 0) frameNode.paddingLeft = paddingLeft;
      if (paddingRight !== void 0) frameNode.paddingRight = paddingRight;
      if (itemSpacing !== void 0) frameNode.itemSpacing = itemSpacing;
      if (primaryAxisAlignItems !== void 0) {
        frameNode.primaryAxisAlignItems = primaryAxisAlignItems;
      }
      if (counterAxisAlignItems !== void 0) {
        frameNode.counterAxisAlignItems = counterAxisAlignItems;
      }
      if (layoutWrap !== void 0) {
        frameNode.layoutWrap = layoutWrap;
      }
      if (strokesIncludedInLayout !== void 0) {
        frameNode.strokesIncludedInLayout = strokesIncludedInLayout;
      }
      if (clipsContent !== void 0) {
        frameNode.clipsContent = clipsContent;
      }
    }
    return {
      id: frameNode.id,
      name: frameNode.name,
      layoutMode: frameNode.layoutMode,
      paddingTop: frameNode.paddingTop,
      paddingBottom: frameNode.paddingBottom,
      paddingLeft: frameNode.paddingLeft,
      paddingRight: frameNode.paddingRight,
      itemSpacing: frameNode.itemSpacing,
      primaryAxisAlignItems: frameNode.primaryAxisAlignItems,
      counterAxisAlignItems: frameNode.counterAxisAlignItems,
      layoutWrap: frameNode.layoutWrap,
      strokesIncludedInLayout: frameNode.strokesIncludedInLayout,
      clipsContent: frameNode.clipsContent
    };
  }
  async function setFontName(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const family = safeParams.family;
    const style = safeParams.style !== null && safeParams.style !== void 0 ? safeParams.style : "Regular";
    if (!nodeId || !family) {
      throw new Error("Missing nodeId or font family");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      await figma.loadFontAsync({ family, style });
      node.fontName = { family, style };
      return {
        id: node.id,
        name: node.name,
        fontName: node.fontName
      };
    } catch (error) {
      throw new Error(`Error setting font name: ${error.message}`);
    }
  }
  async function setFontSize(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const fontSize = safeParams.fontSize;
    if (!nodeId || fontSize === void 0) {
      throw new Error("Missing nodeId or fontSize");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      await figma.loadFontAsync(node.fontName);
      node.fontSize = fontSize;
      return {
        id: node.id,
        name: node.name,
        fontSize: node.fontSize
      };
    } catch (error) {
      throw new Error(`Error setting font size: ${error.message}`);
    }
  }
  async function setFontWeight(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const weight = safeParams.weight;
    if (!nodeId || weight === void 0) {
      throw new Error("Missing nodeId or weight");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      const rawFontName = node.fontName;
      const family = rawFontName === figma.mixed ? node.getRangeFontName(0, 1) : rawFontName;
      const resolvedFamily = family.family;
      const style = getFontStyle(weight);
      await figma.loadFontAsync({ family: resolvedFamily, style });
      node.fontName = { family: resolvedFamily, style };
      return {
        id: node.id,
        name: node.name,
        fontName: node.fontName,
        weight
      };
    } catch (error) {
      throw new Error(`Error setting font weight: ${error.message}`);
    }
  }
  async function setLetterSpacing(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const letterSpacing = safeParams.letterSpacing;
    const unit = safeParams.unit !== null && safeParams.unit !== void 0 ? safeParams.unit : "PIXELS";
    if (!nodeId || letterSpacing === void 0) {
      throw new Error("Missing nodeId or letterSpacing");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      const lsFontName = node.fontName;
      const lsFont = lsFontName === figma.mixed ? node.getRangeFontName(0, 1) : lsFontName;
      await figma.loadFontAsync(lsFont);
      node.letterSpacing = {
        value: letterSpacing,
        unit
      };
      return {
        id: node.id,
        name: node.name,
        letterSpacing: node.letterSpacing
      };
    } catch (error) {
      throw new Error(`Error setting letter spacing: ${error.message}`);
    }
  }
  async function setLineHeight(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const lineHeight = safeParams.lineHeight;
    const unit = safeParams.unit !== null && safeParams.unit !== void 0 ? safeParams.unit : "PIXELS";
    if (!nodeId || lineHeight === void 0) {
      throw new Error("Missing nodeId or lineHeight");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      const lhFontName = node.fontName;
      const lhFont = lhFontName === figma.mixed ? node.getRangeFontName(0, 1) : lhFontName;
      await figma.loadFontAsync(lhFont);
      node.lineHeight = {
        value: lineHeight,
        unit
      };
      return {
        id: node.id,
        name: node.name,
        lineHeight: node.lineHeight
      };
    } catch (error) {
      throw new Error(`Error setting line height: ${error.message}`);
    }
  }
  async function setParagraphSpacing(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const paragraphSpacing = safeParams.paragraphSpacing;
    if (!nodeId || paragraphSpacing === void 0) {
      throw new Error("Missing nodeId or paragraphSpacing");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      const psFontName = node.fontName;
      const psFont = psFontName === figma.mixed ? node.getRangeFontName(0, 1) : psFontName;
      await figma.loadFontAsync(psFont);
      node.paragraphSpacing = paragraphSpacing;
      return {
        id: node.id,
        name: node.name,
        paragraphSpacing: node.paragraphSpacing
      };
    } catch (error) {
      throw new Error(`Error setting paragraph spacing: ${error.message}`);
    }
  }
  async function setTextCase(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const textCase = safeParams.textCase;
    if (!nodeId || textCase === void 0) {
      throw new Error("Missing nodeId or textCase");
    }
    if (!["ORIGINAL", "UPPER", "LOWER", "TITLE"].includes(textCase)) {
      throw new Error(
        "Invalid textCase value. Must be one of: ORIGINAL, UPPER, LOWER, TITLE"
      );
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      const tcFontName = node.fontName;
      const tcFont = tcFontName === figma.mixed ? node.getRangeFontName(0, 1) : tcFontName;
      await figma.loadFontAsync(tcFont);
      node.textCase = textCase;
      return {
        id: node.id,
        name: node.name,
        textCase: node.textCase
      };
    } catch (error) {
      throw new Error(`Error setting text case: ${error.message}`);
    }
  }
  async function setTextDecoration(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const textDecoration = safeParams.textDecoration;
    if (!nodeId || textDecoration === void 0) {
      throw new Error("Missing nodeId or textDecoration");
    }
    if (!["NONE", "UNDERLINE", "STRIKETHROUGH"].includes(textDecoration)) {
      throw new Error(
        "Invalid textDecoration value. Must be one of: NONE, UNDERLINE, STRIKETHROUGH"
      );
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      const tdFontName = node.fontName;
      const tdFont = tdFontName === figma.mixed ? node.getRangeFontName(0, 1) : tdFontName;
      await figma.loadFontAsync(tdFont);
      node.textDecoration = textDecoration;
      return {
        id: node.id,
        name: node.name,
        textDecoration: node.textDecoration
      };
    } catch (error) {
      throw new Error(
        `Error setting text decoration: ${error.message}`
      );
    }
  }
  async function getStyledTextSegments(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const property = safeParams.property;
    if (!nodeId || !property) {
      throw new Error("Missing nodeId or property");
    }
    const validProperties = [
      "fillStyleId",
      "fontName",
      "fontSize",
      "textCase",
      "textDecoration",
      "textStyleId",
      "fills",
      "letterSpacing",
      "lineHeight",
      "fontWeight"
    ];
    if (!validProperties.includes(property)) {
      throw new Error(
        `Invalid property. Must be one of: ${validProperties.join(", ")}`
      );
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (node.type !== "TEXT") {
      throw new Error(`Node is not a text node: ${nodeId}`);
    }
    try {
      const segments = node.getStyledTextSegments([
        property
      ]);
      const safeSegments = segments.map((segment) => {
        const safeSegment = {
          characters: segment.characters,
          start: segment.start,
          end: segment.end
        };
        if (property === "fontName") {
          const val = segment[property];
          if (val !== null && val !== void 0 && typeof val === "object") {
            safeSegment[property] = {
              family: val.family || "",
              style: val.style || ""
            };
          } else {
            safeSegment[property] = { family: "", style: "" };
          }
        } else if (property === "letterSpacing" || property === "lineHeight") {
          const val = segment[property];
          if (val !== null && val !== void 0 && typeof val === "object") {
            const typedVal = val;
            safeSegment[property] = {
              value: typedVal.value !== null && typedVal.value !== void 0 ? typedVal.value : 0,
              unit: typedVal.unit !== null && typedVal.unit !== void 0 && typedVal.unit !== "" ? typedVal.unit : "PIXELS"
            };
          } else {
            safeSegment[property] = { value: 0, unit: "PIXELS" };
          }
        } else if (property === "fills") {
          const val = segment[property];
          safeSegment[property] = val !== null && val !== void 0 ? JSON.parse(JSON.stringify(val)) : [];
        } else {
          safeSegment[property] = segment[property];
        }
        return safeSegment;
      });
      return {
        id: node.id,
        name: node.name,
        property,
        segments: safeSegments
      };
    } catch (error) {
      throw new Error(
        `Error getting styled text segments: ${error.message}`
      );
    }
  }
  async function loadFontAsyncWrapper(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const family = safeParams.family;
    const style = safeParams.style !== null && safeParams.style !== void 0 ? safeParams.style : "Regular";
    if (!family) {
      throw new Error("Missing font family");
    }
    try {
      await figma.loadFontAsync({ family, style });
      return {
        success: true,
        family,
        style,
        message: `Successfully loaded ${family} ${style}`
      };
    } catch (error) {
      throw new Error(`Error loading font: ${error.message}`);
    }
  }
  async function createTextStyle(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const name = safeParams.name;
    const description = safeParams.description;
    if (!nodeId || !name) {
      throw new Error("Missing nodeId or name parameter");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== "TEXT") {
      throw new Error("Node is not a text node");
    }
    const textNode = node;
    try {
      await figma.loadFontAsync(textNode.fontName);
    } catch (error) {
      const fn = textNode.fontName;
      throw new Error(
        `Font "${fn.family} ${fn.style}" is not available. Please ensure the font is installed.`
      );
    }
    try {
      const textStyle = figma.createTextStyle();
      textStyle.name = name;
      if (description !== null && description !== void 0) {
        textStyle.description = description;
      }
      textStyle.fontSize = textNode.fontSize;
      textStyle.fontName = textNode.fontName;
      textStyle.letterSpacing = textNode.letterSpacing;
      textStyle.lineHeight = textNode.lineHeight;
      textStyle.paragraphIndent = textNode.paragraphIndent;
      textStyle.paragraphSpacing = textNode.paragraphSpacing;
      textStyle.textCase = textNode.textCase;
      textStyle.textDecoration = textNode.textDecoration;
      return {
        id: textStyle.id,
        name: textStyle.name,
        key: textStyle.key,
        fontName: textStyle.fontName,
        fontSize: textStyle.fontSize
      };
    } catch (error) {
      throw new Error(`Error creating text style: ${error.message}`);
    }
  }
  async function createTextStyleFromProperties(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const name = safeParams.name;
    const fontSize = safeParams.fontSize;
    const fontFamily = safeParams.fontFamily;
    const fontStyle = safeParams.fontStyle;
    const fontWeight = safeParams.fontWeight;
    const lineHeight = safeParams.lineHeight;
    const letterSpacing = safeParams.letterSpacing;
    const textCase = safeParams.textCase;
    const textDecoration = safeParams.textDecoration;
    const description = safeParams.description;
    if (!name || !fontSize || !fontFamily) {
      throw new Error("Missing required parameters: name, fontSize, or fontFamily");
    }
    let actualFontStyle;
    if (fontStyle !== null && fontStyle !== void 0) {
      actualFontStyle = fontStyle;
    } else if (fontWeight !== null && fontWeight !== void 0) {
      if (fontWeight >= 900) actualFontStyle = "Black";
      else if (fontWeight >= 800) actualFontStyle = "Extra Bold";
      else if (fontWeight >= 700) actualFontStyle = "Bold";
      else if (fontWeight >= 600) actualFontStyle = "Semi Bold";
      else if (fontWeight >= 500) actualFontStyle = "Medium";
      else if (fontWeight >= 400) actualFontStyle = "Regular";
      else if (fontWeight >= 300) actualFontStyle = "Light";
      else if (fontWeight >= 200) actualFontStyle = "Extra Light";
      else if (fontWeight >= 100) actualFontStyle = "Thin";
      else actualFontStyle = "Regular";
    } else {
      actualFontStyle = "Regular";
    }
    try {
      await figma.loadFontAsync({ family: fontFamily, style: actualFontStyle });
    } catch (error) {
      throw new Error(
        `Font "${fontFamily} ${actualFontStyle}" is not available. Please ensure the font is installed or use a different font.`
      );
    }
    try {
      const textStyle = figma.createTextStyle();
      textStyle.name = name;
      if (description !== null && description !== void 0) {
        textStyle.description = description;
      }
      textStyle.fontSize = fontSize;
      textStyle.fontName = { family: fontFamily, style: actualFontStyle };
      if (lineHeight !== null && lineHeight !== void 0) {
        textStyle.lineHeight = lineHeight;
      }
      if (letterSpacing !== null && letterSpacing !== void 0) {
        textStyle.letterSpacing = letterSpacing;
      }
      if (textCase !== null && textCase !== void 0) {
        textStyle.textCase = textCase;
      }
      if (textDecoration !== null && textDecoration !== void 0) {
        textStyle.textDecoration = textDecoration;
      }
      return {
        id: textStyle.id,
        name: textStyle.name,
        key: textStyle.key,
        fontName: textStyle.fontName,
        fontSize: textStyle.fontSize
      };
    } catch (error) {
      throw new Error(
        `Error creating text style from properties: ${error.message}`
      );
    }
  }
  async function applyTextStyle(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const nodeId = safeParams.nodeId;
    const styleId = safeParams.styleId;
    if (!nodeId || !styleId) {
      throw new Error("Missing nodeId or styleId parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || node.type !== "TEXT") {
        throw new Error("Node is not a text node");
      }
      const style = await figma.getStyleByIdAsync(styleId);
      if (!style || style.type !== "TEXT") {
        throw new Error("Style not found or is not a text style");
      }
      await figma.loadFontAsync(style.fontName);
      await node.setTextStyleIdAsync(styleId);
      return {
        nodeName: node.name,
        styleName: style.name
      };
    } catch (error) {
      throw new Error(`Error applying text style: ${error.message}`);
    }
  }
  async function getTextStyles() {
    try {
      const textStyles = await figma.getLocalTextStylesAsync();
      return {
        count: textStyles.length,
        styles: textStyles.map((style) => ({
          id: style.id,
          name: style.name,
          key: style.key,
          description: style.description || "",
          fontSize: style.fontSize,
          fontName: style.fontName,
          letterSpacing: style.letterSpacing,
          lineHeight: style.lineHeight,
          paragraphIndent: style.paragraphIndent,
          paragraphSpacing: style.paragraphSpacing,
          textCase: style.textCase,
          textDecoration: style.textDecoration
        }))
      };
    } catch (error) {
      throw new Error(`Error getting text styles: ${error.message}`);
    }
  }
  async function deleteTextStyle(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const styleId = safeParams.styleId;
    if (!styleId) {
      throw new Error("Missing styleId parameter");
    }
    try {
      const style = await figma.getStyleByIdAsync(styleId);
      if (!style || style.type !== "TEXT") {
        throw new Error("Style not found or is not a text style");
      }
      const styleName = style.name;
      const styleIdCopy = style.id;
      style.remove();
      return {
        name: styleName,
        id: styleIdCopy
      };
    } catch (error) {
      throw new Error(`Error deleting text style: ${error.message}`);
    }
  }
  async function updateTextStyle(params) {
    const safeParams = params !== null && params !== void 0 ? params : {};
    const styleId = safeParams.styleId;
    const name = safeParams.name;
    const description = safeParams.description;
    const fontSize = safeParams.fontSize;
    const fontFamily = safeParams.fontFamily;
    const fontStyle = safeParams.fontStyle;
    const fontWeight = safeParams.fontWeight;
    const lineHeight = safeParams.lineHeight;
    const letterSpacing = safeParams.letterSpacing;
    const textCase = safeParams.textCase;
    const textDecoration = safeParams.textDecoration;
    const paragraphSpacing = safeParams.paragraphSpacing;
    const paragraphIndent = safeParams.paragraphIndent;
    if (!styleId) {
      throw new Error("Missing styleId parameter");
    }
    try {
      const style = await figma.getStyleByIdAsync(styleId);
      if (!style || style.type !== "TEXT") {
        throw new Error("Style not found or is not a text style");
      }
      const textStyle = style;
      const updatedProperties = [];
      if (name !== void 0) {
        textStyle.name = name;
        updatedProperties.push("name");
      }
      if (description !== void 0) {
        textStyle.description = description;
        updatedProperties.push("description");
      }
      if (fontFamily !== void 0 || fontStyle !== void 0 || fontWeight !== void 0) {
        const newFontFamily = fontFamily !== null && fontFamily !== void 0 ? fontFamily : textStyle.fontName.family;
        let newFontStyle;
        if (fontStyle !== null && fontStyle !== void 0) {
          newFontStyle = fontStyle;
        } else if (fontWeight !== null && fontWeight !== void 0) {
          if (fontWeight >= 900) newFontStyle = "Black";
          else if (fontWeight >= 800) newFontStyle = "Extra Bold";
          else if (fontWeight >= 700) newFontStyle = "Bold";
          else if (fontWeight >= 600) newFontStyle = "Semi Bold";
          else if (fontWeight >= 500) newFontStyle = "Medium";
          else if (fontWeight >= 400) newFontStyle = "Regular";
          else if (fontWeight >= 300) newFontStyle = "Light";
          else if (fontWeight >= 200) newFontStyle = "Extra Light";
          else if (fontWeight >= 100) newFontStyle = "Thin";
          else newFontStyle = "Regular";
        } else {
          newFontStyle = textStyle.fontName.style;
        }
        try {
          await figma.loadFontAsync({
            family: newFontFamily,
            style: newFontStyle
          });
        } catch (error) {
          throw new Error(
            `Font "${newFontFamily} ${newFontStyle}" is not available. Please ensure the font is installed or use a different font.`
          );
        }
        textStyle.fontName = { family: newFontFamily, style: newFontStyle };
        updatedProperties.push("fontName");
      }
      if (fontSize !== void 0) {
        textStyle.fontSize = fontSize;
        updatedProperties.push("fontSize");
      }
      if (lineHeight !== void 0) {
        textStyle.lineHeight = lineHeight;
        updatedProperties.push("lineHeight");
      }
      if (letterSpacing !== void 0) {
        textStyle.letterSpacing = letterSpacing;
        updatedProperties.push("letterSpacing");
      }
      if (textCase !== void 0) {
        textStyle.textCase = textCase;
        updatedProperties.push("textCase");
      }
      if (textDecoration !== void 0) {
        textStyle.textDecoration = textDecoration;
        updatedProperties.push("textDecoration");
      }
      if (paragraphSpacing !== void 0) {
        textStyle.paragraphSpacing = paragraphSpacing;
        updatedProperties.push("paragraphSpacing");
      }
      if (paragraphIndent !== void 0) {
        textStyle.paragraphIndent = paragraphIndent;
        updatedProperties.push("paragraphIndent");
      }
      return {
        id: textStyle.id,
        name: textStyle.name,
        updatedProperties
      };
    } catch (error) {
      throw new Error(`Error updating text style: ${error.message}`);
    }
  }

  // src/claude_mcp_plugin/handlers/effects.ts
  async function setEffects(params) {
    const nodeId = params["nodeId"];
    const effects = params["effects"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!effects || !Array.isArray(effects)) {
      throw new Error(
        "Missing or invalid effects parameter. Must be an array."
      );
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found with ID: ${nodeId}`);
    }
    if (!("effects" in node)) {
      throw new Error(`Node does not support effects: ${nodeId}`);
    }
    const hasGlass = effects.some(
      (e) => e["type"] === "GLASS"
    );
    if (hasGlass) {
      const frameTypes = ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"];
      if (!frameTypes.includes(node.type)) {
        throw new Error(
          `GLASS effect is only supported on frame-like nodes (FRAME, COMPONENT, INSTANCE). Got: ${node.type}`
        );
      }
    }
    try {
      const validEffects = effects.map(
        (effect) => {
          if (!effect["type"]) {
            throw new Error("Each effect must have a type property");
          }
          switch (effect["type"]) {
            case "DROP_SHADOW":
            case "INNER_SHADOW":
              return {
                type: effect["type"],
                color: effect["color"] || { r: 0, g: 0, b: 0, a: 0.5 },
                offset: effect["offset"] || { x: 0, y: 0 },
                radius: effect["radius"] !== void 0 ? effect["radius"] : 5,
                spread: effect["spread"] !== void 0 ? effect["spread"] : 0,
                visible: effect["visible"] !== void 0 ? effect["visible"] : true,
                blendMode: effect["blendMode"] !== void 0 ? effect["blendMode"] : "NORMAL"
              };
            case "LAYER_BLUR":
            case "BACKGROUND_BLUR":
              return {
                type: effect["type"],
                radius: effect["radius"] !== void 0 ? effect["radius"] : 5,
                visible: effect["visible"] !== void 0 ? effect["visible"] : true
              };
            case "NOISE": {
              const noiseEffect = {
                type: "NOISE",
                noiseType: effect["noiseType"] !== void 0 ? effect["noiseType"] : "MONOTONE",
                color: effect["color"] !== void 0 ? effect["color"] : { r: 0, g: 0, b: 0, a: 0.1 },
                noiseSize: effect["noiseSize"] !== void 0 ? effect["noiseSize"] : 1,
                density: effect["density"] !== void 0 ? effect["density"] : 0.5,
                blendMode: effect["blendMode"] !== void 0 ? effect["blendMode"] : "NORMAL",
                visible: effect["visible"] !== void 0 ? effect["visible"] : true
              };
              if (effect["noiseType"] === "DUOTONE" && effect["secondaryColor"] !== void 0) {
                noiseEffect["secondaryColor"] = effect["secondaryColor"];
              }
              if (effect["noiseType"] === "MULTITONE" && effect["opacity"] !== void 0) {
                noiseEffect["opacity"] = effect["opacity"];
              }
              return noiseEffect;
            }
            case "TEXTURE":
              return {
                type: "TEXTURE",
                noiseSize: effect["noiseSize"] !== void 0 ? effect["noiseSize"] : 1,
                radius: effect["radius"] !== void 0 ? effect["radius"] : 0,
                clipToShape: effect["clipToShape"] !== void 0 ? effect["clipToShape"] : true,
                visible: effect["visible"] !== void 0 ? effect["visible"] : true
              };
            case "GLASS":
              return {
                type: "GLASS",
                lightIntensity: effect["lightIntensity"] !== void 0 ? effect["lightIntensity"] : 0.5,
                lightAngle: effect["lightAngle"] !== void 0 ? effect["lightAngle"] : 0,
                refraction: effect["refraction"] !== void 0 ? effect["refraction"] : 0.5,
                depth: effect["depth"] !== void 0 ? effect["depth"] : 0.5,
                dispersion: effect["dispersion"] !== void 0 ? effect["dispersion"] : 0,
                radius: effect["radius"] !== void 0 ? effect["radius"] : 0,
                visible: effect["visible"] !== void 0 ? effect["visible"] : true
              };
            default:
              throw new Error(`Unsupported effect type: ${effect["type"]}`);
          }
        }
      );
      node.effects = validEffects;
      const effectNode = node;
      return {
        id: node.id,
        name: node.name,
        effects: effectNode.effects
      };
    } catch (error) {
      throw new Error(`Error setting effects: ${error.message}`);
    }
  }
  async function setEffectStyleId(params) {
    const nodeId = params["nodeId"];
    const effectStyleId = params["effectStyleId"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!effectStyleId) {
      throw new Error("Missing effectStyleId parameter");
    }
    try {
      let timeoutId = setTimeout(() => {
      }, 0);
      clearTimeout(timeoutId);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              "Timeout while setting effect style ID (8s). The operation took too long to complete."
            )
          );
        }, 8e3);
      });
      debugLog(
        `Starting to set effect style ID ${effectStyleId} on node ${nodeId}...`
      );
      const nodePromise = (async () => {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
          throw new Error(`Node not found with ID: ${nodeId}`);
        }
        if (!("effectStyleId" in node)) {
          throw new Error(
            `Node with ID ${nodeId} does not support effect styles`
          );
        }
        debugLog(`Fetching effect styles to validate style ID: ${effectStyleId}`);
        const effectStyles = await figma.getLocalEffectStylesAsync();
        const foundStyle = effectStyles.find(
          (style) => style.id === effectStyleId
        );
        if (!foundStyle) {
          throw new Error(
            `Effect style not found with ID: ${effectStyleId}. Available styles: ${effectStyles.length}`
          );
        }
        debugLog(`Effect style found, applying to node...`);
        const effectNode = node;
        await effectNode.setEffectStyleIdAsync(effectStyleId);
        return {
          id: node.id,
          name: node.name,
          effectStyleId: effectNode.effectStyleId,
          appliedEffects: effectNode.effects
        };
      })();
      let result;
      try {
        result = await Promise.race([nodePromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
      debugLog(`Successfully set effect style ID on node ${nodeId}`);
      return result;
    } catch (error) {
      const err = error;
      console.error(`Error setting effect style ID: ${err.message || "Unknown error"}`);
      console.error(
        `Stack trace: ${err.stack !== void 0 ? err.stack : "Not available"}`
      );
      if (err.message.includes("timeout") || err.message.includes("Timeout")) {
        throw new Error(
          `The operation timed out after 8 seconds. This could happen with complex nodes or effects. Try with a simpler node or effect style.`
        );
      } else if (err.message.includes("not found") && err.message.includes("Node")) {
        throw new Error(
          `Node with ID "${nodeId}" not found. Make sure the node exists in the current document.`
        );
      } else if (err.message.includes("not found") && err.message.includes("style")) {
        throw new Error(
          `Effect style with ID "${effectStyleId}" not found. Make sure the style exists in your local styles.`
        );
      } else if (err.message.includes("does not support")) {
        throw new Error(
          `The selected node type does not support effect styles. Only certain node types like frames, components, and instances can have effect styles.`
        );
      } else {
        throw new Error(`Error setting effect style ID: ${err.message}`);
      }
    }
  }
  function buildValidStyleEffect(effect) {
    if (!effect["type"]) {
      throw new Error("Each effect must have a type property");
    }
    switch (effect["type"]) {
      case "DROP_SHADOW":
      case "INNER_SHADOW":
        return {
          type: effect["type"],
          color: effect["color"] || { r: 0, g: 0, b: 0, a: 0.5 },
          offset: effect["offset"] || { x: 0, y: 0 },
          radius: effect["radius"] !== void 0 ? effect["radius"] : 5,
          spread: effect["spread"] !== void 0 ? effect["spread"] : 0,
          visible: effect["visible"] !== void 0 ? effect["visible"] : true,
          blendMode: effect["blendMode"] !== void 0 ? effect["blendMode"] : "NORMAL"
        };
      case "LAYER_BLUR":
      case "BACKGROUND_BLUR":
        return {
          type: effect["type"],
          radius: effect["radius"] !== void 0 ? effect["radius"] : 5,
          visible: effect["visible"] !== void 0 ? effect["visible"] : true
        };
      default:
        throw new Error(
          `Unsupported effect type for style: ${effect["type"]}. Supported: DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR`
        );
    }
  }
  async function createEffectStyle(params) {
    const name = params["name"];
    const effects = params["effects"];
    const description = params["description"];
    if (!name) {
      throw new Error("Missing required parameter: name");
    }
    if (!effects || !Array.isArray(effects) || effects.length === 0) {
      throw new Error(
        "Missing required parameter: effects (must be a non-empty array)"
      );
    }
    try {
      const validEffects = effects.map(
        buildValidStyleEffect
      );
      const effectStyle = figma.createEffectStyle();
      effectStyle.name = name;
      effectStyle.effects = validEffects;
      if (description !== void 0) {
        effectStyle.description = description;
      }
      return {
        id: effectStyle.id,
        name: effectStyle.name,
        key: effectStyle.key,
        effects: effectStyle.effects
      };
    } catch (error) {
      throw new Error(
        `Error creating effect style: ${error.message}`
      );
    }
  }
  async function updateEffectStyle(params) {
    const styleId = params["styleId"];
    const name = params["name"];
    const effects = params["effects"];
    const description = params["description"];
    if (!styleId) {
      throw new Error("Missing required parameter: styleId");
    }
    try {
      const style = await figma.getStyleByIdAsync(styleId);
      if (!style || style.type !== "EFFECT") {
        throw new Error("Style not found or is not an effect style");
      }
      const effectStyle = style;
      const updatedProperties = [];
      if (name !== void 0) {
        effectStyle.name = name;
        updatedProperties.push("name");
      }
      if (description !== void 0) {
        effectStyle.description = description;
        updatedProperties.push("description");
      }
      if (effects !== void 0) {
        if (!Array.isArray(effects) || effects.length === 0) {
          throw new Error("effects must be a non-empty array");
        }
        effectStyle.effects = effects.map(
          buildValidStyleEffect
        );
        updatedProperties.push("effects");
      }
      return {
        id: effectStyle.id,
        name: effectStyle.name,
        key: effectStyle.key,
        effects: effectStyle.effects,
        updatedProperties
      };
    } catch (error) {
      throw new Error(
        `Error updating effect style: ${error.message}`
      );
    }
  }
  async function deleteEffectStyle(params) {
    const styleId = params["styleId"];
    if (!styleId) {
      throw new Error("Missing required parameter: styleId");
    }
    try {
      const style = await figma.getStyleByIdAsync(styleId);
      if (!style || style.type !== "EFFECT") {
        throw new Error("Style not found or is not an effect style");
      }
      const styleName = style.name;
      const styleIdCopy = style.id;
      style.remove();
      return {
        id: styleIdCopy,
        name: styleName
      };
    } catch (error) {
      throw new Error(
        `Error deleting effect style: ${error.message}`
      );
    }
  }

  // src/claude_mcp_plugin/handlers/components.ts
  async function getStyles() {
    const styles = {
      colors: await figma.getLocalPaintStylesAsync(),
      texts: await figma.getLocalTextStylesAsync(),
      effects: await figma.getLocalEffectStylesAsync(),
      grids: await figma.getLocalGridStylesAsync()
    };
    return {
      colors: styles.colors.map((style) => ({
        id: style.id,
        name: style.name,
        key: style.key,
        paint: style.paints[0]
      })),
      texts: styles.texts.map((style) => ({
        id: style.id,
        name: style.name,
        key: style.key,
        fontSize: style.fontSize,
        fontName: style.fontName
      })),
      effects: styles.effects.map((style) => ({
        id: style.id,
        name: style.name,
        key: style.key
      })),
      grids: styles.grids.map((style) => ({
        id: style.id,
        name: style.name,
        key: style.key
      }))
    };
  }
  async function getLocalComponents() {
    await figma.loadAllPagesAsync();
    const components = figma.root.findAllWithCriteria({
      types: ["COMPONENT"]
    });
    return {
      count: components.length,
      components: components.map((component) => ({
        id: component.id,
        name: component.name,
        key: "key" in component ? component.key : null
      }))
    };
  }
  async function createComponentInstance(params) {
    const componentKey = params["componentKey"];
    const x = params["x"] !== void 0 ? params["x"] : 0;
    const y = params["y"] !== void 0 ? params["y"] : 0;
    const parentId = params["parentId"];
    if (!componentKey) {
      throw new Error("Missing componentKey parameter");
    }
    try {
      let component = null;
      if (componentKey.includes(":")) {
        debugLog(`Trying to find local component with ID: ${componentKey}...`);
        const localNode = await figma.getNodeByIdAsync(componentKey);
        if (localNode !== null && localNode.type === "COMPONENT") {
          component = localNode;
          debugLog(`Found local component "${component.name}"`);
        }
      }
      if (!component) {
        debugLog(
          `Trying to import remote component with key: ${componentKey}...`
        );
        try {
          component = await figma.importComponentByKeyAsync(componentKey);
          if (component) {
            debugLog(`Imported remote component "${component.name}"`);
          }
        } catch (importError) {
          const errMsg = importError instanceof Error ? importError.message : String(importError);
          console.error(`Failed to import remote component: ${errMsg}`);
        }
      }
      if (!component) {
        throw new Error(
          `Component not found. For local components, use the component's node ID (e.g., "123:456"). For library components, use the component key. Key provided: "${componentKey}"`
        );
      }
      debugLog(`Creating instance of "${component.name}"...`);
      const instance = component.createInstance();
      instance.x = x;
      instance.y = y;
      if (parentId !== void 0) {
        const parent = await figma.getNodeByIdAsync(parentId);
        if (!parent) {
          throw new Error(`Parent node with ID ${parentId} not found`);
        }
        if ("appendChild" in parent) {
          parent.appendChild(instance);
        } else {
          throw new Error(
            `Parent node "${parent.name}" cannot contain children (type: ${parent.type})`
          );
        }
      } else {
        figma.currentPage.appendChild(instance);
      }
      debugLog(
        `Component instance "${instance.name}" created successfully at (${x}, ${y})`
      );
      const mainComponent = instance.mainComponent;
      return {
        id: instance.id,
        name: instance.name,
        x: instance.x,
        y: instance.y,
        width: instance.width,
        height: instance.height,
        componentId: mainComponent !== null ? mainComponent.id : null,
        parentId: parentId !== void 0 ? parentId : figma.currentPage.id
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error in createComponentInstance: ${errorMessage}`);
      throw new Error(
        errorMessage || `Failed to create component instance for "${componentKey}"`
      );
    }
  }
  async function getRemoteComponents() {
    try {
      if (!figma.teamLibrary) {
        console.error("Error: figma.teamLibrary API is not available");
        throw new Error(
          "The figma.teamLibrary API is not available in this context"
        );
      }
      const teamLibraryAny = figma.teamLibrary;
      if (!teamLibraryAny.getAvailableComponentsAsync) {
        console.error(
          "Error: figma.teamLibrary.getAvailableComponentsAsync is not available"
        );
        throw new Error(
          "The getAvailableComponentsAsync method is not available"
        );
      }
      debugLog("Starting remote components retrieval...");
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              "Internal timeout while retrieving remote components (15s)"
            )
          );
        }, 15e3);
      });
      const fetchPromise = teamLibraryAny.getAvailableComponentsAsync();
      let teamComponents;
      try {
        teamComponents = await Promise.race([fetchPromise, timeoutPromise]);
      } finally {
        if (timeoutId !== void 0) clearTimeout(timeoutId);
      }
      debugLog(`Retrieved ${teamComponents.length} remote components`);
      return {
        success: true,
        count: teamComponents.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        components: teamComponents.map((component) => ({
          key: component.key,
          name: component.name,
          description: component.description !== void 0 ? component.description : "",
          libraryName: component.libraryName
        }))
      };
    } catch (error) {
      const err = error;
      console.error(
        `Detailed error retrieving remote components: ${err.message !== void 0 ? err.message : "Unknown error"}`
      );
      console.error(
        `Stack trace: ${err.stack !== void 0 ? err.stack : "Not available"}`
      );
      throw new Error(
        `Error retrieving remote components: ${err.message}`
      );
    }
  }
  async function detachInstance(params) {
    const nodeId = params["nodeId"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      if (node.type !== "INSTANCE") {
        throw new Error(
          `Node with ID ${nodeId} is not an INSTANCE. Only component instances can be detached.`
        );
      }
      const detached = node.detachInstance();
      return {
        id: detached.id,
        name: detached.name,
        type: detached.type
      };
    } catch (error) {
      throw new Error(
        `Error detaching instance: ${error.message}`
      );
    }
  }
  async function createComponent(params) {
    const nodeId = params["nodeId"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      const convertibleTypes = [
        "FRAME",
        "GROUP",
        "RECTANGLE",
        "ELLIPSE",
        "POLYGON",
        "STAR",
        "VECTOR",
        "TEXT",
        "LINE"
      ];
      if (!convertibleTypes.includes(node.type)) {
        throw new Error(
          `Node with ID ${nodeId} is of type ${node.type} and cannot be converted to a component. Only FRAME, GROUP, and shape nodes can be converted.`
        );
      }
      const component = figma.createComponentFromNode(
        node
      );
      return {
        id: component.id,
        name: component.name,
        key: component.key
      };
    } catch (error) {
      throw new Error(
        `Error creating component: ${error.message}`
      );
    }
  }
  async function createComponentSet(params) {
    const nodeIds = params["nodeIds"];
    const name = params["name"];
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 1) {
      throw new Error(
        "Must provide at least one nodeId to create a component set"
      );
    }
    try {
      const components = [];
      for (const nodeId of nodeIds) {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
          throw new Error(`Node not found with ID: ${nodeId}`);
        }
        if (node.type === "COMPONENT") {
          components.push(node);
        } else if (node.type === "FRAME" || node.type === "GROUP") {
          const component = figma.createComponentFromNode(
            node
          );
          components.push(component);
        } else {
          throw new Error(
            `Node with ID ${nodeId} is of type ${node.type}. Only COMPONENT, FRAME, or GROUP nodes can be used in a component set.`
          );
        }
      }
      const parent = components[0].parent;
      const componentSet = figma.combineAsVariants(components, parent);
      if (name !== void 0) {
        componentSet.name = name;
      }
      return {
        id: componentSet.id,
        name: componentSet.name,
        variantCount: components.length
      };
    } catch (error) {
      throw new Error(
        `Error creating component set: ${error.message}`
      );
    }
  }
  async function addComponentProperty(params) {
    const nodeId = params["nodeId"];
    const propertyName = params["propertyName"];
    const type = params["type"];
    const defaultValue = params["defaultValue"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!propertyName) {
      throw new Error("Missing propertyName parameter");
    }
    if (!type) {
      throw new Error("Missing type parameter");
    }
    const validTypes = ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"];
    if (!validTypes.includes(type)) {
      throw new Error(
        `Invalid type: ${type}. Must be one of: ${validTypes.join(", ")}`
      );
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(
          `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`
        );
      }
      let actualDefaultValue = defaultValue;
      if (type === "BOOLEAN" && actualDefaultValue === void 0) {
        actualDefaultValue = true;
      } else if (type === "TEXT" && actualDefaultValue === void 0) {
        actualDefaultValue = "";
      } else if (type === "VARIANT" && actualDefaultValue === void 0) {
        actualDefaultValue = "Default";
      } else if (type === "INSTANCE_SWAP" && actualDefaultValue === void 0) {
        throw new Error(
          "INSTANCE_SWAP type requires a defaultValue (component key)"
        );
      }
      const componentNode = node;
      const fullPropertyName = componentNode.addComponentProperty(
        propertyName,
        type,
        actualDefaultValue
      );
      return {
        nodeId: node.id,
        nodeName: node.name,
        propertyName: fullPropertyName,
        type,
        defaultValue: actualDefaultValue
      };
    } catch (error) {
      throw new Error(
        `Error adding component property: ${error.message}`
      );
    }
  }
  async function editComponentProperty(params) {
    const nodeId = params["nodeId"];
    const propertyName = params["propertyName"];
    const newName = params["newName"];
    const newDefaultValue = params["newDefaultValue"];
    const preferredValues = params["preferredValues"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!propertyName) {
      throw new Error("Missing propertyName parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(
          `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`
        );
      }
      const updateObj = {};
      if (newName !== void 0) {
        updateObj["name"] = newName;
      }
      if (newDefaultValue !== void 0) {
        updateObj["defaultValue"] = newDefaultValue;
      }
      if (preferredValues !== void 0) {
        updateObj["preferredValues"] = preferredValues;
      }
      if (Object.keys(updateObj).length === 0) {
        throw new Error(
          "Must provide at least one of: newName, newDefaultValue, or preferredValues"
        );
      }
      const componentNode = node;
      const updatedPropertyName = componentNode.editComponentProperty(
        propertyName,
        updateObj
      );
      return {
        nodeId: node.id,
        nodeName: node.name,
        oldPropertyName: propertyName,
        newPropertyName: updatedPropertyName,
        updates: updateObj
      };
    } catch (error) {
      throw new Error(
        `Error editing component property: ${error.message}`
      );
    }
  }
  async function deleteComponentProperty(params) {
    const nodeId = params["nodeId"];
    const propertyName = params["propertyName"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!propertyName) {
      throw new Error("Missing propertyName parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(
          `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`
        );
      }
      const componentNode = node;
      componentNode.deleteComponentProperty(propertyName);
      return {
        nodeId: node.id,
        nodeName: node.name,
        deletedPropertyName: propertyName
      };
    } catch (error) {
      throw new Error(
        `Error deleting component property: ${error.message}`
      );
    }
  }
  async function setComponentPropertyReferences(params) {
    const nodeId = params["nodeId"];
    const references = params["references"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    if (!references || typeof references !== "object") {
      throw new Error(
        "Missing or invalid references parameter (must be an object)"
      );
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      if (!("componentPropertyReferences" in node)) {
        throw new Error(
          `Node does not support componentPropertyReferences. It must be a sublayer of a component.`
        );
      }
      node.componentPropertyReferences = references;
      const refNode = node;
      return {
        nodeId: node.id,
        nodeName: node.name,
        references: refNode.componentPropertyReferences
      };
    } catch (error) {
      throw new Error(
        `Error setting component property references: ${error.message}`
      );
    }
  }
  async function getComponentProperties(params) {
    const nodeId = params["nodeId"];
    if (!nodeId) {
      throw new Error("Missing nodeId parameter");
    }
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${nodeId}`);
      }
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(
          `Node must be a COMPONENT or COMPONENT_SET, got: ${node.type}`
        );
      }
      const componentNode = node;
      const definitions = componentNode.componentPropertyDefinitions !== void 0 ? componentNode.componentPropertyDefinitions : {};
      return {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        properties: definitions
      };
    } catch (error) {
      throw new Error(
        `Error getting component properties: ${error.message}`
      );
    }
  }

  // src/claude_mcp_plugin/handlers/variables.ts
  async function fetchVariableData() {
    const [collections, variables] = await Promise.all([
      figma.variables.getLocalVariableCollectionsAsync(),
      figma.variables.getLocalVariablesAsync()
    ]);
    return { collections, variables };
  }
  function findCollectionIn(collections, collectionIdOrName) {
    let collection = collections.find((c) => c.id === collectionIdOrName);
    if (!collection) {
      collection = collections.find((c) => c.name === collectionIdOrName);
    }
    if (!collection) {
      throw new Error(`Collection not found: ${collectionIdOrName}`);
    }
    return collection;
  }
  function findVariableIn(variables, collections, variableIdOrName, collectionId) {
    let variable = variables.find((v) => v.id === variableIdOrName);
    if (!variable && collectionId !== void 0 && collectionId !== null) {
      const collection = findCollectionIn(collections, collectionId);
      variable = variables.find(
        (v) => v.name === variableIdOrName && v.variableCollectionId === collection.id
      );
    }
    if (!variable) {
      throw new Error(`Variable not found: ${variableIdOrName}`);
    }
    return variable;
  }
  async function findCollection(collectionIdOrName) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    return findCollectionIn(collections, collectionIdOrName);
  }
  async function findVariable(variableIdOrName, collectionId) {
    const { collections, variables } = await fetchVariableData();
    return findVariableIn(variables, collections, variableIdOrName, collectionId);
  }
  function calculateColorScaleFigma(baseColor, backgroundColor) {
    const mixPercentages = {
      "50": 0.05,
      "100": 0.1,
      "200": 0.2,
      "300": 0.3,
      "400": 0.4,
      "500": 0.5,
      "600": 0.6,
      "700": 0.7,
      "800": 0.8,
      "900": 0.9
    };
    const scale = {};
    for (const level of Object.keys(mixPercentages)) {
      const mix = mixPercentages[level];
      const invMix = 1 - mix;
      scale[level] = {
        r: baseColor.r * mix + backgroundColor.r * invMix,
        g: baseColor.g * mix + backgroundColor.g * invMix,
        b: baseColor.b * mix + backgroundColor.b * invMix,
        a: 1
      };
    }
    return scale;
  }
  function getStandardSchemaFigma(includeChartColors = false) {
    const baseVariables = [
      // Surfaces
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      // Brand
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "tertiary",
      "tertiary-foreground",
      "accent",
      "accent-foreground",
      // States
      "success",
      "success-foreground",
      "info",
      "info-foreground",
      "warning",
      "warning-foreground",
      "destructive",
      "destructive-foreground",
      // Interactive
      "link",
      "link-hover",
      // Feedback
      "overlay",
      "tooltip",
      "tooltip-foreground",
      "placeholder",
      "placeholder-foreground",
      // Utility
      "muted",
      "muted-foreground",
      "selected",
      "selected-foreground",
      "border",
      "input",
      "ring"
    ];
    const scaleColors = [
      "primary",
      "secondary",
      "accent",
      "success",
      "info",
      "warning",
      "destructive"
    ];
    const levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    const scaleVariables = [];
    for (const color of scaleColors) {
      for (const level of levels) {
        scaleVariables.push(`${color}-${level}`);
      }
    }
    let allVariables = [...baseVariables, ...scaleVariables];
    if (includeChartColors) {
      allVariables.push(
        "chart-1",
        "chart-2",
        "chart-3",
        "chart-4",
        "chart-5",
        "chart-6",
        "chart-7",
        "chart-8"
      );
    }
    return allVariables;
  }
  function getDefaultDarkTheme() {
    return {
      // Surfaces
      "background": { r: 0.059, g: 0.063, b: 0.067, a: 1 },
      "foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      "card": { r: 0.059, g: 0.063, b: 0.067, a: 1 },
      "card-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      "popover": { r: 0.059, g: 0.063, b: 0.067, a: 1 },
      "popover-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      // Brand colors
      "primary": { r: 0.639, g: 0.902, b: 0.208, a: 1 },
      "primary-foreground": { r: 0.09, g: 0.102, b: 0.067, a: 1 },
      "secondary": { r: 0.149, g: 0.153, b: 0.153, a: 1 },
      "secondary-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      "tertiary": { r: 0.059, g: 0.063, b: 0.067, a: 1 },
      "tertiary-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      "accent": { r: 0.149, g: 0.153, b: 0.153, a: 1 },
      "accent-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      // State colors
      "success": { r: 0.078, g: 0.325, b: 0.176, a: 1 },
      "success-foreground": { r: 0.576, g: 0.773, b: 0.655, a: 1 },
      "info": { r: 0.118, g: 0.251, b: 0.686, a: 1 },
      "info-foreground": { r: 0.576, g: 0.773, b: 0.992, a: 1 },
      "warning": { r: 0.863, g: 0.696, b: 0.149, a: 1 },
      "warning-foreground": { r: 0.09, g: 0.102, b: 0.067, a: 1 },
      "destructive": { r: 0.863, g: 0.149, b: 0.149, a: 1 },
      "destructive-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      // Interactive
      "link": { r: 0.576, g: 0.773, b: 0.992, a: 1 },
      "link-hover": { r: 0.384, g: 0.608, b: 0.929, a: 1 },
      // Feedback
      "overlay": { r: 0, g: 0, b: 0, a: 0.8 },
      "tooltip": { r: 0.059, g: 0.063, b: 0.067, a: 1 },
      "tooltip-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      "placeholder": { r: 0.45, g: 0.45, b: 0.45, a: 1 },
      "placeholder-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      // Utility
      "muted": { r: 0.149, g: 0.153, b: 0.153, a: 1 },
      "muted-foreground": { r: 0.639, g: 0.647, b: 0.655, a: 1 },
      "selected": { r: 0.149, g: 0.153, b: 0.153, a: 1 },
      "selected-foreground": { r: 0.98, g: 0.98, b: 0.98, a: 1 },
      "border": { r: 0.149, g: 0.153, b: 0.153, a: 1 },
      "input": { r: 0.149, g: 0.153, b: 0.153, a: 1 },
      "ring": { r: 0.639, g: 0.902, b: 0.208, a: 1 }
    };
  }
  function getCategoryForVariable(name) {
    if (/^(background|foreground|card|popover)/.test(name)) return "surfaces";
    if (/^(primary|secondary|tertiary|accent)/.test(name)) return "brand";
    if (/^(success|info|warning|destructive)/.test(name)) return "states";
    if (/^(link)/.test(name)) return "interactive";
    if (/^(overlay|tooltip|placeholder)/.test(name)) return "feedback";
    if (/^(muted|selected|border|input|ring)/.test(name)) return "utility";
    if (/^chart-/.test(name)) return "chart";
    return "unknown";
  }
  function getDescriptionForVariable(name) {
    const descriptions = {
      background: "Background color",
      foreground: "Foreground text color",
      primary: "Primary brand color",
      success: "Success state color",
      info: "Info state color",
      warning: "Warning state color",
      destructive: "Destructive/error state color"
    };
    if (name.endsWith("-foreground")) {
      const base = name.slice(0, -11);
      return `Text/icons for ${base}`;
    }
    if (/-\d+$/.test(name)) {
      return "Color scale variant";
    }
    return descriptions[name] !== void 0 ? descriptions[name] : "Theme variable";
  }
  async function getVariables() {
    const { variables, collections } = await fetchVariableData();
    return {
      variables: variables.map((v) => ({
        id: v.id,
        name: v.name,
        key: v.key,
        type: v.resolvedType,
        description: v.description || "",
        collectionId: v.variableCollectionId,
        values: Object.entries(v.valuesByMode).map(([modeId, value]) => {
          const knownTypes = ["COLOR", "FLOAT", "STRING", "BOOLEAN"];
          const resolvedType = knownTypes.includes(v.resolvedType) ? v.resolvedType : "STRING";
          return {
            modeId,
            value: formatVariableValue(value, resolvedType)
          };
        })
      })),
      collections: collections.map((c) => ({
        id: c.id,
        name: c.name,
        variableIds: c.variableIds,
        modes: c.modes.map((m) => ({ id: m.modeId, name: m.name }))
      }))
    };
  }
  async function getBoundVariables(params) {
    const nodeId = params["nodeId"];
    if (!nodeId) {
      throw new Error("nodeId is required");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    const bindings = [];
    const variables = await figma.variables.getLocalVariablesAsync();
    const variableMap = new Map(variables.map((v) => [v.id, v]));
    if ("boundVariables" in node && node.boundVariables) {
      for (const [field, binding] of Object.entries(
        node.boundVariables
      )) {
        if (binding) {
          const processBinding = (b, fieldPath) => {
            if (b && b["id"]) {
              const variableEntry = variableMap.get(b["id"]);
              bindings.push({
                field: fieldPath,
                variableId: b["id"],
                variableName: variableEntry !== void 0 ? variableEntry.name : "Unknown",
                variableType: variableEntry !== void 0 ? variableEntry.resolvedType : "Unknown"
              });
            }
          };
          if (Array.isArray(binding)) {
            binding.forEach((b, index) => {
              processBinding(b, `${field}/${index}`);
            });
          } else {
            processBinding(binding, field);
          }
        }
      }
    }
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      bindings
    };
  }
  async function bindVariable(params) {
    const nodeId = params["nodeId"];
    const variableId = params["variableId"];
    const field = params["field"];
    if (!nodeId || !variableId || !field) {
      throw new Error("nodeId, variableId, and field are required");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      throw new Error(`Variable not found: ${variableId}`);
    }
    const fieldParts = field.split("/");
    try {
      if (fieldParts[0] === "fills" && fieldParts.length >= 2) {
        const fillIndex = parseInt(fieldParts[1]);
        if (isNaN(fillIndex)) {
          throw new Error(`Invalid fill index: ${fieldParts[1]}`);
        }
        if ("fills" in node) {
          const nodeWithFills = node;
          const currentFills = nodeWithFills.fills;
          const fillsCopy = currentFills !== figma.mixed ? [...currentFills] : [];
          while (fillsCopy.length <= fillIndex) {
            fillsCopy.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
          }
          nodeWithFills.fills = fillsCopy;
          const updatedFills = [...nodeWithFills.fills];
          updatedFills[fillIndex] = figma.variables.setBoundVariableForPaint(
            updatedFills[fillIndex],
            "color",
            variable
          );
          nodeWithFills.fills = updatedFills;
        }
      } else if (fieldParts[0] === "strokes" && fieldParts.length >= 2) {
        const strokeIndex = parseInt(fieldParts[1]);
        if (isNaN(strokeIndex)) {
          throw new Error(`Invalid stroke index: ${fieldParts[1]}`);
        }
        if ("strokes" in node) {
          const nodeWithStrokes = node;
          const strokesCopy = [...nodeWithStrokes.strokes];
          while (strokesCopy.length <= strokeIndex) {
            strokesCopy.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
          }
          nodeWithStrokes.strokes = strokesCopy;
          const updatedStrokes = [...nodeWithStrokes.strokes];
          updatedStrokes[strokeIndex] = figma.variables.setBoundVariableForPaint(
            updatedStrokes[strokeIndex],
            "color",
            variable
          );
          nodeWithStrokes.strokes = updatedStrokes;
        }
      } else {
        const propertyName = fieldParts[0];
        node.setBoundVariable(
          propertyName,
          variable
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to bind variable: ${errMsg}. Make sure the variable type (${variable.resolvedType}) is compatible with the field "${field}"`
      );
    }
    return {
      nodeId: node.id,
      nodeName: node.name,
      field,
      variableId: variable.id,
      variableName: variable.name,
      variableType: variable.resolvedType
    };
  }
  async function unbindVariable(params) {
    const nodeId = params["nodeId"];
    const field = params["field"];
    if (!nodeId || !field) {
      throw new Error("nodeId and field are required");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    const fieldParts = field.split("/");
    try {
      if (fieldParts[0] === "fills" && fieldParts.length >= 2) {
        const fillIndex = parseInt(fieldParts[1]);
        if (isNaN(fillIndex)) {
          throw new Error(`Invalid fill index: ${fieldParts[1]}`);
        }
        if ("fills" in node) {
          const nodeWithFills = node;
          const currentFills = nodeWithFills.fills;
          if (currentFills !== figma.mixed && Array.isArray(currentFills)) {
            const fills = [...currentFills];
            const fillEntry = fills[fillIndex];
            if (fillEntry && fillEntry["boundVariables"]) {
              const newFill = Object.assign({}, fillEntry);
              delete newFill["boundVariables"];
              fills[fillIndex] = newFill;
              nodeWithFills.fills = fills;
            }
          }
        }
      } else if (fieldParts[0] === "strokes" && fieldParts.length >= 2) {
        const strokeIndex = parseInt(fieldParts[1]);
        if (isNaN(strokeIndex)) {
          throw new Error(`Invalid stroke index: ${fieldParts[1]}`);
        }
        if ("strokes" in node) {
          const nodeWithStrokes = node;
          const strokes = [...nodeWithStrokes.strokes];
          const strokeEntry = strokes[strokeIndex];
          if (strokeEntry && strokeEntry["boundVariables"]) {
            const newStroke = Object.assign({}, strokeEntry);
            delete newStroke["boundVariables"];
            strokes[strokeIndex] = newStroke;
            nodeWithStrokes.strokes = strokes;
          }
        }
      } else {
        const propertyName = fieldParts[0];
        node.setBoundVariable(
          propertyName,
          null
        );
      }
      return {
        nodeId: node.id,
        nodeName: node.name,
        field,
        success: true
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to unbind variable: ${errMsg}`);
    }
  }
  async function getVariableCollections() {
    const { collections, variables } = await fetchVariableData();
    return {
      collections: collections.map((c) => {
        const collectionVariables = variables.filter(
          (v) => v.variableCollectionId === c.id
        );
        return {
          id: c.id,
          name: c.name,
          modes: c.modes.map((m) => m.name),
          variableCount: collectionVariables.length,
          defaultMode: c.modes[0] !== void 0 && c.modes[0] !== null ? c.modes[0].name : "Mode 1"
        };
      })
    };
  }
  async function createVariableCollection(params) {
    const name = params["name"];
    const defaultMode = params["defaultMode"];
    const collection = figma.variables.createVariableCollection(name);
    const mode = collection.modes[0];
    collection.renameMode(mode.modeId, defaultMode !== void 0 && defaultMode !== null ? defaultMode : "dark");
    return {
      collectionId: collection.id,
      name: collection.name,
      defaultMode: defaultMode !== void 0 && defaultMode !== null ? defaultMode : "dark",
      success: true
    };
  }
  async function getCollectionInfo(params) {
    const collectionId = params["collectionId"];
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const baseCount = collectionVariables.filter(
      (v) => !/-\d+$/.test(v.name) && !v.name.startsWith("chart-")
    ).length;
    const scaleCount = collectionVariables.filter(
      (v) => /-(50|100|200|300|400|500|600|700|800|900)$/.test(v.name)
    ).length;
    const chartCount = collectionVariables.filter(
      (v) => v.name.startsWith("chart-")
    ).length;
    return {
      id: collection.id,
      name: collection.name,
      modes: collection.modes.map((m) => m.name),
      defaultMode: collection.modes[0] !== void 0 && collection.modes[0] !== null ? collection.modes[0].name : "Mode 1",
      variableCount: collectionVariables.length,
      variablesByCategory: {
        base: baseCount,
        scales: scaleCount,
        chart: chartCount
      }
    };
  }
  async function renameVariableCollection(params) {
    const collectionId = params["collectionId"];
    const newName = params["newName"];
    if (!newName) {
      throw new Error("Missing newName parameter");
    }
    const collection = await findCollection(collectionId);
    const oldName = collection.name;
    collection.name = newName;
    return {
      id: collection.id,
      oldName,
      newName: collection.name,
      success: true
    };
  }
  async function deleteVariableCollection(params) {
    const collectionId = params["collectionId"];
    const { collections: _colsDvc, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_colsDvc, collectionId);
    const collectionName = collection.name;
    const collectionIdValue = collection.id;
    const variableCount = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    ).length;
    collection.remove();
    return {
      id: collectionIdValue,
      name: collectionName,
      variablesDeleted: variableCount,
      success: true
    };
  }
  async function createVariable(params) {
    const collectionId = params["collectionId"];
    const name = params["name"];
    const type = params["type"];
    const value = params["value"];
    const mode = params["mode"];
    const collection = await findCollection(collectionId);
    const variableType = type !== void 0 && type !== null ? type : "COLOR";
    const variable = figma.variables.createVariable(name, collection, variableType);
    const targetMode = mode !== void 0 && mode !== null ? collection.modes.find((m) => m.name === mode) : null;
    const modeId = targetMode !== void 0 && targetMode !== null ? targetMode.modeId : collection.modes[0].modeId;
    if (!modeId) {
      throw new Error(`Mode not found: ${mode}`);
    }
    let variableValue;
    if (variableType === "COLOR") {
      const colorValue = value;
      variableValue = {
        r: colorValue.r,
        g: colorValue.g,
        b: colorValue.b,
        a: colorValue.a !== void 0 ? colorValue.a : 1
      };
    } else {
      variableValue = value;
    }
    variable.setValueForMode(modeId, variableValue);
    return {
      variableId: variable.id,
      name: variable.name,
      type: variable.resolvedType,
      success: true
    };
  }
  async function createVariablesBatch(params) {
    const collectionId = params["collectionId"];
    const variableDefs = params["variables"];
    const mode = params["mode"];
    const collection = await findCollection(collectionId);
    const targetMode = mode !== void 0 && mode !== null ? collection.modes.find((m) => m.name === mode) : null;
    const modeId = targetMode !== void 0 && targetMode !== null ? targetMode.modeId : collection.modes[0].modeId;
    if (!modeId) {
      throw new Error(`Mode not found: ${mode}`);
    }
    const created = [];
    const failed = [];
    const variableIds = [];
    const errors = [];
    for (const varDef of variableDefs) {
      try {
        const variableType = varDef["type"] !== void 0 && varDef["type"] !== null ? varDef["type"] : "COLOR";
        const variable = figma.variables.createVariable(
          varDef["name"],
          collection,
          variableType
        );
        let variableValue;
        if (variableType === "COLOR") {
          const colorValue = varDef["value"];
          variableValue = {
            r: colorValue.r,
            g: colorValue.g,
            b: colorValue.b,
            a: colorValue.a !== void 0 ? colorValue.a : 1
          };
        } else {
          variableValue = varDef["value"];
        }
        variable.setValueForMode(modeId, variableValue);
        created.push(varDef["name"]);
        variableIds.push(variable.id);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        failed.push(varDef["name"]);
        errors.push({ name: varDef["name"], error: errMsg });
      }
    }
    return {
      created: created.length,
      failed: failed.length,
      variableIds,
      errors
    };
  }
  async function updateVariableValue(params) {
    const variableId = params["variableId"];
    const collectionId = params["collectionId"];
    const value = params["value"];
    const mode = params["mode"];
    const variable = await findVariable(variableId, collectionId);
    const collection = await figma.variables.getVariableCollectionByIdAsync(
      variable.variableCollectionId
    );
    if (!collection) {
      throw new Error(
        `Variable collection not found for variable ${variable.name}`
      );
    }
    const targetMode = mode !== void 0 && mode !== null ? collection.modes.find((m) => m.name === mode) : null;
    const modeId = targetMode !== void 0 && targetMode !== null ? targetMode.modeId : collection.modes[0].modeId;
    if (!modeId) {
      throw new Error(`Mode not found: ${mode}`);
    }
    const variableType = variable.resolvedType;
    let variableValue;
    if (variableType === "COLOR") {
      if (typeof value !== "object" || value.r === void 0) {
        throw new Error(
          `Expected color value with r, g, b properties for COLOR variable "${variable.name}"`
        );
      }
      const colorValue = value;
      variableValue = {
        r: colorValue.r,
        g: colorValue.g,
        b: colorValue.b,
        a: colorValue.a !== void 0 ? colorValue.a : 1
      };
    } else if (variableType === "FLOAT") {
      if (typeof value !== "number") {
        throw new Error(
          `Expected number value for FLOAT variable "${variable.name}", got ${typeof value}`
        );
      }
      variableValue = value;
    } else if (variableType === "STRING") {
      if (typeof value !== "string") {
        throw new Error(
          `Expected string value for STRING variable "${variable.name}", got ${typeof value}`
        );
      }
      variableValue = value;
    } else if (variableType === "BOOLEAN") {
      if (typeof value !== "boolean") {
        throw new Error(
          `Expected boolean value for BOOLEAN variable "${variable.name}", got ${typeof value}`
        );
      }
      variableValue = value;
    } else {
      throw new Error(`Unsupported variable type: ${variableType}`);
    }
    variable.setValueForMode(modeId, variableValue);
    return {
      variableId: variable.id,
      name: variable.name,
      type: variableType,
      updated: true
    };
  }
  async function renameVariable(params) {
    const variableId = params["variableId"];
    const collectionId = params["collectionId"];
    const newName = params["newName"];
    const variable = await findVariable(variableId, collectionId);
    const oldName = variable.name;
    variable.name = newName;
    return {
      variableId: variable.id,
      oldName,
      newName: variable.name,
      success: true
    };
  }
  async function deleteVariable(params) {
    const variableId = params["variableId"];
    const collectionId = params["collectionId"];
    const variable = await findVariable(variableId, collectionId);
    const name = variable.name;
    const id = variable.id;
    variable.remove();
    return {
      variableId: id,
      name,
      deleted: true
    };
  }
  async function deleteVariablesBatch(params) {
    const variableIds = params["variableIds"];
    const collectionId = params["collectionId"];
    let deleted = 0;
    let failed = 0;
    const errors = [];
    for (const varId of variableIds) {
      try {
        const variable = await findVariable(varId, collectionId);
        variable.remove();
        deleted++;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        failed++;
        errors.push({ variableId: varId, error: errMsg });
      }
    }
    return {
      deleted,
      failed,
      errors
    };
  }
  async function auditCollection(params) {
    const collectionId = params["collectionId"];
    const includeChartColors = params["includeChartColors"];
    const customSchema = params["customSchema"];
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const standardVariables = customSchema !== void 0 && customSchema !== null ? customSchema : getStandardSchemaFigma(includeChartColors === true);
    const existingNames = collectionVariables.map((v) => v.name);
    const expectedCount = includeChartColors === true ? 110 : 102;
    const existingSet = new Set(existingNames);
    const standardSet = new Set(standardVariables);
    const missing = standardVariables.filter((name) => !existingSet.has(name));
    const nonStandard = existingNames.filter((name) => !standardSet.has(name));
    const compliancePercentage = ((existingNames.length - nonStandard.length) / expectedCount * 100).toFixed(1);
    return {
      status: missing.length === 0 && nonStandard.length === 0 ? "Complete" : "Incomplete",
      totalVariables: existingNames.length,
      expectedVariables: expectedCount,
      compliancePercentage: parseFloat(compliancePercentage),
      missing: {
        count: missing.length,
        variables: missing
      },
      nonStandard: {
        count: nonStandard.length,
        variables: nonStandard.map((name) => ({
          name,
          recommendation: "Review if needed or remove if not in standard schema",
          action: "review"
        }))
      },
      existing: {
        count: existingNames.length,
        variables: existingNames
      }
    };
  }
  async function validateColorContrast(params) {
    const collectionId = params["collectionId"];
    const mode = params["mode"];
    const standard = params["standard"];
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const targetMode = mode !== void 0 && mode !== null ? collection.modes.find((m) => m.name === mode) : null;
    const modeId = targetMode !== void 0 && targetMode !== null ? targetMode.modeId : collection.modes[0].modeId;
    if (!modeId) {
      throw new Error(`Mode not found: ${mode}`);
    }
    function getLuminance(color) {
      const linearize = (val) => val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
      const r = linearize(color.r);
      const g = linearize(color.g);
      const b = linearize(color.b);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function getContrastRatio(fg, bg) {
      const lum1 = getLuminance(fg);
      const lum2 = getLuminance(bg);
      const lighter = Math.max(lum1, lum2);
      const darker = Math.min(lum1, lum2);
      return (lighter + 0.05) / (darker + 0.05);
    }
    const pairs = [];
    const fgSuffix = "-foreground";
    for (const variable of collectionVariables) {
      if (variable.name.endsWith(fgSuffix)) {
        const baseName = variable.name.slice(0, -fgSuffix.length);
        const baseVariable = collectionVariables.find(
          (v) => v.name === baseName
        );
        if (baseVariable) {
          const fgValue = variable.valuesByMode[modeId];
          const bgValue = baseVariable.valuesByMode[modeId];
          if (fgValue !== void 0 && fgValue !== null && bgValue !== void 0 && bgValue !== null && typeof fgValue === "object" && typeof bgValue === "object") {
            const ratio = getContrastRatio(fgValue, bgValue);
            const minRatio = standard === "AAA" ? 7 : 4.5;
            const pass = ratio >= minRatio;
            pairs.push({
              foreground: variable.name,
              background: baseVariable.name,
              ratio: parseFloat(ratio.toFixed(2)),
              pass,
              level: standard !== void 0 && standard !== null ? standard : "AA",
              recommendation: pass ? `Meets ${standard} standards` : `Increase contrast - needs ${minRatio}:1 for ${standard} normal text`
            });
          }
        }
      }
    }
    const passed = pairs.filter((p) => p["pass"]).length;
    const failed = pairs.filter((p) => !p["pass"]).length;
    return {
      totalPairs: pairs.length,
      passed,
      failed,
      pairs
    };
  }
  async function suggestMissingVariables(params) {
    const collectionId = params["collectionId"];
    const useDefaults = params["useDefaults"];
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const standardVariables = getStandardSchemaFigma(false);
    const existingNames = collectionVariables.map((v) => v.name);
    const existingNamesSet = new Set(existingNames);
    const missing = standardVariables.filter((name) => !existingNamesSet.has(name));
    const defaultTheme = getDefaultDarkTheme();
    const backgroundColor = defaultTheme["background"];
    const suggestions = missing.map((name) => {
      let suggestedValue = useDefaults !== false ? defaultTheme[name] !== void 0 ? defaultTheme[name] : null : null;
      if (useDefaults !== false && (suggestedValue === null || suggestedValue === void 0) && /-(50|100|200|300|400|500|600|700|800|900)$/.test(name)) {
        const parts = name.split("-");
        const baseName = parts[0];
        const level = parts[1];
        const baseColor = defaultTheme[baseName];
        if (baseColor !== void 0) {
          const scale = calculateColorScaleFigma(baseColor, backgroundColor);
          suggestedValue = scale[level] !== void 0 ? scale[level] : null;
        }
      }
      return {
        name,
        category: getCategoryForVariable(name),
        suggestedValue,
        description: getDescriptionForVariable(name)
      };
    });
    return {
      missingCount: missing.length,
      suggestions
    };
  }
  async function applyDefaultTheme(params) {
    const collectionId = params["collectionId"];
    const overwriteExisting = params["overwriteExisting"];
    const includeChartColors = params["includeChartColors"];
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const existingNames = new Set(collectionVariables.map((v) => v.name));
    const varByName = /* @__PURE__ */ new Map();
    for (const v of collectionVariables) {
      varByName.set(v.name, v);
    }
    const defaultTheme = getDefaultDarkTheme();
    const backgroundColor = defaultTheme["background"];
    const modeId = collection.modes[0].modeId;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const [name, value] of Object.entries(defaultTheme)) {
      if (existingNames.has(name)) {
        if (overwriteExisting === true) {
          const variable = varByName.get(name);
          if (variable !== void 0) {
            variable.setValueForMode(modeId, value);
          }
          updated++;
        } else {
          skipped++;
        }
      } else {
        const variable = figma.variables.createVariable(name, collection, "COLOR");
        variable.setValueForMode(modeId, value);
        varByName.set(name, variable);
        created++;
      }
    }
    const scaleColors = [
      "primary",
      "secondary",
      "accent",
      "success",
      "info",
      "warning",
      "destructive"
    ];
    for (const colorName of scaleColors) {
      const baseColor = defaultTheme[colorName];
      if (baseColor !== void 0) {
        const scale = calculateColorScaleFigma(baseColor, backgroundColor);
        for (const [level, value] of Object.entries(scale)) {
          const varName = `${colorName}-${level}`;
          if (existingNames.has(varName)) {
            if (overwriteExisting === true) {
              const variable = varByName.get(varName);
              if (variable !== void 0) {
                variable.setValueForMode(modeId, value);
              }
              updated++;
            } else {
              skipped++;
            }
          } else {
            const variable = figma.variables.createVariable(varName, collection, "COLOR");
            variable.setValueForMode(modeId, value);
            varByName.set(varName, variable);
            created++;
          }
        }
      }
    }
    if (includeChartColors === true) {
      const chartColors = [
        { r: 0.639, g: 0.902, b: 0.208, a: 1 },
        { r: 0.118, g: 0.251, b: 0.686, a: 1 },
        { r: 0.863, g: 0.696, b: 0.149, a: 1 },
        { r: 0.863, g: 0.149, b: 0.149, a: 1 },
        { r: 0.576, g: 0.773, b: 0.992, a: 1 },
        { r: 0.078, g: 0.325, b: 0.176, a: 1 },
        { r: 0.98, g: 0.588, b: 0.118, a: 1 },
        { r: 0.639, g: 0.384, b: 0.863, a: 1 }
      ];
      for (let i = 0; i < chartColors.length; i++) {
        const varName = `chart-${i + 1}`;
        if (existingNames.has(varName)) {
          if (overwriteExisting === true) {
            const variable = collectionVariables.find((v) => v.name === varName);
            if (variable !== void 0) {
              variable.setValueForMode(modeId, chartColors[i]);
            }
            updated++;
          } else {
            skipped++;
          }
        } else {
          const variable = figma.variables.createVariable(varName, collection, "COLOR");
          variable.setValueForMode(modeId, chartColors[i]);
          created++;
        }
      }
    }
    return {
      created,
      updated,
      skipped,
      success: true,
      message: `Applied default ${includeChartColors === true ? "dark theme with chart colors" : "dark theme"} - ${created + updated} variables`
    };
  }
  async function createColorScaleSet(params) {
    const collectionId = params["collectionId"];
    const colorName = params["colorName"];
    const baseColor = params["baseColor"];
    const foregroundColor = params["foregroundColor"];
    const backgroundColor = params["backgroundColor"];
    const mode = params["mode"];
    const collection = await findCollection(collectionId);
    const targetMode = mode !== void 0 && mode !== null ? collection.modes.find((m) => m.name === mode) : null;
    const modeId = targetMode !== void 0 && targetMode !== null ? targetMode.modeId : collection.modes[0].modeId;
    if (!modeId) {
      throw new Error(`Mode not found: ${mode}`);
    }
    const created = [];
    const baseVar = figma.variables.createVariable(colorName, collection, "COLOR");
    baseVar.setValueForMode(modeId, baseColor);
    created.push(colorName);
    const fgVar = figma.variables.createVariable(
      `${colorName}-foreground`,
      collection,
      "COLOR"
    );
    fgVar.setValueForMode(modeId, foregroundColor);
    created.push(`${colorName}-foreground`);
    const scale = calculateColorScaleFigma(baseColor, backgroundColor);
    const scaleVars = [];
    for (const [level, value] of Object.entries(scale)) {
      const varName = `${colorName}-${level}`;
      const variable = figma.variables.createVariable(varName, collection, "COLOR");
      variable.setValueForMode(modeId, value);
      created.push(varName);
      scaleVars.push(varName);
    }
    return {
      created: created.length,
      variables: {
        base: colorName,
        foreground: `${colorName}-foreground`,
        scale: scaleVars
      },
      success: true
    };
  }
  async function applyCustomPalette(params) {
    const collectionId = params["collectionId"];
    const palette = params["palette"];
    const backgroundColor = params["backgroundColor"];
    const regenerateScales = params["regenerateScales"];
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const modeId = collection.modes[0].modeId;
    const varByName = /* @__PURE__ */ new Map();
    for (const v of collectionVariables) {
      varByName.set(v.name, v);
    }
    let baseColorsUpdated = 0;
    let foregroundsUpdated = 0;
    let scalesRegenerated = 0;
    for (const [colorName, colors] of Object.entries(palette)) {
      let baseVar = varByName.get(colorName);
      if (baseVar === void 0) {
        baseVar = figma.variables.createVariable(colorName, collection, "COLOR");
        varByName.set(colorName, baseVar);
      }
      baseVar.setValueForMode(modeId, colors.base);
      baseColorsUpdated++;
      const fgKey = `${colorName}-foreground`;
      let fgVar = varByName.get(fgKey);
      if (fgVar === void 0) {
        fgVar = figma.variables.createVariable(fgKey, collection, "COLOR");
        varByName.set(fgKey, fgVar);
      }
      fgVar.setValueForMode(modeId, colors.foreground);
      foregroundsUpdated++;
      if (regenerateScales !== false) {
        const scale = calculateColorScaleFigma(colors.base, backgroundColor);
        for (const [level, value] of Object.entries(scale)) {
          const varName = `${colorName}-${level}`;
          let scaleVar = varByName.get(varName);
          if (scaleVar === void 0) {
            scaleVar = figma.variables.createVariable(varName, collection, "COLOR");
            varByName.set(varName, scaleVar);
          }
          scaleVar.setValueForMode(modeId, value);
          scalesRegenerated++;
        }
      }
    }
    return {
      baseColorsUpdated,
      foregroundsUpdated,
      scalesRegenerated,
      success: true
    };
  }
  async function reorderVariables(params) {
    const collectionId = params["collectionId"];
    await findCollection(collectionId);
    return {
      reordered: 0,
      success: true,
      message: "Variable reordering is not supported by Figma Plugin API. Variables are ordered alphabetically by Figma."
    };
  }
  async function generateAuditReport(params) {
    const collectionId = params["collectionId"];
    const includeChartColors = params["includeChartColors"];
    const format = params["format"];
    const auditData = await auditCollection({
      collectionId,
      includeChartColors
    });
    if (format === "json") {
      return auditData;
    }
    const lines = [];
    lines.push("=== THEME COLLECTION AUDIT REPORT ===");
    lines.push("");
    lines.push(`Status: ${auditData.status}`);
    lines.push(
      `Total Variables: ${auditData.totalVariables} / ${auditData.expectedVariables} expected`
    );
    lines.push(`Compliance: ${auditData.compliancePercentage}%`);
    lines.push("");
    if (auditData.missing.count > 0) {
      lines.push(`MISSING VARIABLES (${auditData.missing.count}):`);
      auditData.missing.variables.forEach((name) => {
        lines.push(`  - ${name}`);
      });
      lines.push("");
    }
    if (auditData.nonStandard.count > 0) {
      lines.push(`NON-STANDARD VARIABLES (${auditData.nonStandard.count}):`);
      auditData.nonStandard.variables.forEach((item) => {
        lines.push(`  - ${item.name} (${item.recommendation})`);
      });
      lines.push("");
    }
    lines.push("RECOMMENDATIONS:");
    if (auditData.missing.count > 0) {
      lines.push(
        `1. Add ${auditData.missing.count} missing variables to reach ${auditData.expectedVariables}-variable standard`
      );
    }
    if (auditData.nonStandard.count > 0) {
      lines.push(
        `2. Review ${auditData.nonStandard.count} non-standard variables (rename/remove)`
      );
    }
    lines.push("3. Validate color contrast for all foreground variants");
    return lines.join("\n");
  }
  async function exportCollectionSchema(params) {
    const collectionId = params["collectionId"];
    const mode = params["mode"];
    const includeMetadata = params["includeMetadata"];
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const targetMode = mode !== void 0 && mode !== null ? collection.modes.find((m) => m.name === mode) : null;
    const modeId = targetMode !== void 0 && targetMode !== null ? targetMode.modeId : collection.modes[0].modeId;
    if (!modeId) {
      throw new Error(`Mode not found: ${mode}`);
    }
    const schema = {
      schema_version: "1.2",
      variables: {}
    };
    if (includeMetadata !== false) {
      schema["collection"] = {
        name: collection.name,
        modes: collection.modes.map((m) => m.name),
        exportedMode: mode !== void 0 && mode !== null ? mode : collection.modes[0].name,
        variableCount: collectionVariables.length
      };
    }
    const variablesMap = {};
    for (const variable of collectionVariables) {
      const value = variable.valuesByMode[modeId];
      if (value !== void 0 && value !== null && typeof value === "object") {
        variablesMap[variable.name] = {
          type: "COLOR",
          value,
          category: getCategoryForVariable(variable.name)
        };
      }
    }
    schema["variables"] = variablesMap;
    return schema;
  }
  async function importCollectionSchema(params) {
    const collectionId = params["collectionId"];
    const schema = params["schema"];
    const mode = params["mode"];
    const overwriteExisting = params["overwriteExisting"];
    if (!schema || typeof schema !== "object" || typeof schema.variables !== "object") {
      throw new Error('Invalid schema: expected an object with a "variables" map');
    }
    const MAX_IMPORT_VARIABLES = 1e3;
    const entries = Object.entries(schema.variables);
    if (entries.length > MAX_IMPORT_VARIABLES) {
      throw new Error(
        `Schema contains ${entries.length} variables, which exceeds the maximum of ${MAX_IMPORT_VARIABLES} per import`
      );
    }
    const { collections: _cols, variables: allVariables } = await fetchVariableData();
    const collection = findCollectionIn(_cols, collectionId);
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    const existingNames = new Set(collectionVariables.map((v) => v.name));
    const targetMode = mode !== void 0 && mode !== null ? collection.modes.find((m) => m.name === mode) : null;
    const modeId = targetMode !== void 0 && targetMode !== null ? targetMode.modeId : collection.modes[0].modeId;
    if (!modeId) {
      throw new Error(`Mode not found: ${mode}`);
    }
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    for (const [name, varData] of entries) {
      try {
        if (typeof name !== "string" || name.length === 0 || name.length > 256 || /[\x00-\x1f/\\]/.test(name)) {
          failed++;
          errors.push({ name, error: "Invalid variable name" });
          continue;
        }
        if (!varData || typeof varData !== "object" || !("value" in varData)) {
          failed++;
          errors.push({ name, error: "Missing or invalid value" });
          continue;
        }
        if (existingNames.has(name)) {
          if (overwriteExisting === true) {
            const variable = collectionVariables.find((v) => v.name === name);
            if (variable !== void 0) {
              variable.setValueForMode(modeId, varData.value);
            }
            updated++;
          } else {
            skipped++;
          }
        } else {
          const variable = figma.variables.createVariable(name, collection, "COLOR");
          variable.setValueForMode(modeId, varData.value);
          imported++;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        failed++;
        errors.push({ name, error: errMsg });
      }
    }
    return {
      imported,
      updated,
      skipped,
      failed,
      errors
    };
  }
  async function createAllScales(params) {
    const collectionId = params["collectionId"];
    const baseColors = params["baseColors"];
    const backgroundColor = params["backgroundColor"];
    const collection = await findCollection(collectionId);
    const modeId = collection.modes[0].modeId;
    let created = 0;
    const scales = {};
    for (const [colorName, baseColor] of Object.entries(baseColors)) {
      const scale = calculateColorScaleFigma(baseColor, backgroundColor);
      let scaleCount = 0;
      for (const [level, value] of Object.entries(scale)) {
        const varName = `${colorName}-${level}`;
        const variable = figma.variables.createVariable(varName, collection, "COLOR");
        variable.setValueForMode(modeId, value);
        scaleCount++;
        created++;
      }
      scales[colorName] = scaleCount;
    }
    return {
      created,
      scales,
      success: true
    };
  }
  async function fixCollectionToStandard(params) {
    const collectionId = params["collectionId"];
    const preserveCustom = params["preserveCustom"];
    const addChartColorsFlag = params["addChartColors"];
    const useDefaultValues = params["useDefaultValues"];
    const dryRun = params["dryRun"];
    const auditResult = await auditCollection({
      collectionId,
      includeChartColors: addChartColorsFlag
    });
    const analysis = {
      missingBefore: auditResult.missing.count,
      nonStandardBefore: auditResult.nonStandard.count,
      totalBefore: auditResult.totalVariables
    };
    if (dryRun === true) {
      return {
        analysis,
        actions: {
          variablesAdded: auditResult.missing.count,
          variablesRenamed: 0,
          variablesRemoved: preserveCustom === true ? 0 : auditResult.nonStandard.count,
          variablesPreserved: preserveCustom === true ? auditResult.nonStandard.count : 0
        },
        result: {
          totalVariables: auditResult.totalVariables + auditResult.missing.count - (preserveCustom === true ? 0 : auditResult.nonStandard.count),
          compliance: "100%",
          status: "Complete (Dry Run)"
        },
        dryRun: true
      };
    }
    let variablesAdded = 0;
    let variablesRemoved = 0;
    if (useDefaultValues !== false && auditResult.missing.count > 0) {
      const result = await applyDefaultTheme({
        collectionId,
        overwriteExisting: false,
        includeChartColors: addChartColorsFlag
      });
      variablesAdded = result.created;
    }
    if (preserveCustom !== true && auditResult.nonStandard.count > 0) {
      const result = await deleteVariablesBatch({
        variableIds: auditResult.nonStandard.variables.map((v) => v.name),
        collectionId
      });
      variablesRemoved = result.deleted;
    }
    const finalAudit = await auditCollection({
      collectionId,
      includeChartColors: addChartColorsFlag
    });
    return {
      analysis,
      actions: {
        variablesAdded,
        variablesRenamed: 0,
        variablesRemoved,
        variablesPreserved: preserveCustom === true ? auditResult.nonStandard.count : 0
      },
      result: {
        totalVariables: finalAudit.totalVariables,
        compliance: `${finalAudit.compliancePercentage}%`,
        status: finalAudit.status
      },
      success: true
    };
  }
  async function addChartColors(params) {
    const collectionId = params["collectionId"];
    const chartColorsParam = params["chartColors"];
    const collection = await findCollection(collectionId);
    const modeId = collection.modes[0].modeId;
    const defaultChartColors = [
      { r: 0.639, g: 0.902, b: 0.208, a: 1 },
      { r: 0.118, g: 0.251, b: 0.686, a: 1 },
      { r: 0.863, g: 0.696, b: 0.149, a: 1 },
      { r: 0.863, g: 0.149, b: 0.149, a: 1 },
      { r: 0.576, g: 0.773, b: 0.992, a: 1 },
      { r: 0.078, g: 0.325, b: 0.176, a: 1 },
      { r: 0.98, g: 0.588, b: 0.118, a: 1 },
      { r: 0.639, g: 0.384, b: 0.863, a: 1 }
    ];
    const colors = chartColorsParam !== void 0 && chartColorsParam !== null ? chartColorsParam : defaultChartColors;
    const created = [];
    for (let i = 0; i < Math.min(colors.length, 8); i++) {
      const varName = `chart-${i + 1}`;
      const variable = figma.variables.createVariable(varName, collection, "COLOR");
      variable.setValueForMode(modeId, colors[i]);
      created.push(varName);
    }
    return {
      created: created.length,
      chartColors: created,
      success: true
    };
  }
  async function addModeToCollection(params) {
    const collectionId = params["collectionId"];
    const modeName = params["modeName"];
    const collection = await findCollection(collectionId);
    const newModeId = collection.addMode(modeName);
    const newMode = collection.modes.find((m) => m.modeId === newModeId);
    return {
      collectionId: collection.id,
      collectionName: collection.name,
      modeId: newModeId,
      modeName: newMode !== void 0 && newMode !== null ? newMode.name : modeName,
      totalModes: collection.modes.length,
      success: true
    };
  }
  async function renameMode(params) {
    const collectionId = params["collectionId"];
    const oldModeName = params["oldModeName"];
    const newModeName = params["newModeName"];
    const collection = await findCollection(collectionId);
    const mode = collection.modes.find((m) => m.name === oldModeName);
    if (!mode) {
      throw new Error(`Mode "${oldModeName}" not found in collection`);
    }
    collection.renameMode(mode.modeId, newModeName);
    return {
      collectionId: collection.id,
      collectionName: collection.name,
      modeId: mode.modeId,
      oldName: oldModeName,
      newName: newModeName,
      success: true
    };
  }
  async function deleteMode(params) {
    const collectionId = params["collectionId"];
    const modeName = params["modeName"];
    const collection = await findCollection(collectionId);
    if (collection.modes.length <= 1) {
      throw new Error("Cannot delete the last mode in a collection");
    }
    const mode = collection.modes.find((m) => m.name === modeName);
    if (!mode) {
      throw new Error(`Mode "${modeName}" not found in collection`);
    }
    collection.removeMode(mode.modeId);
    return {
      collectionId: collection.id,
      collectionName: collection.name,
      deletedMode: modeName,
      remainingModes: collection.modes.map((m) => m.name),
      success: true
    };
  }
  async function duplicateModeValues(params) {
    const collectionId = params["collectionId"];
    const sourceMode = params["sourceMode"];
    const targetMode = params["targetMode"];
    const transformColors = params["transformColors"];
    const collection = await findCollection(collectionId);
    const sourceModeObj = collection.modes.find((m) => m.name === sourceMode);
    const targetModeObj = collection.modes.find((m) => m.name === targetMode);
    if (!sourceModeObj) {
      throw new Error(`Source mode "${sourceMode}" not found`);
    }
    if (!targetModeObj) {
      throw new Error(`Target mode "${targetMode}" not found`);
    }
    const sourceModeId = sourceModeObj.modeId;
    const targetModeId = targetModeObj.modeId;
    const allVariables = await figma.variables.getLocalVariablesAsync();
    const collectionVariables = allVariables.filter(
      (v) => v.variableCollectionId === collection.id
    );
    let copied = 0;
    let transformed = 0;
    for (const variable of collectionVariables) {
      try {
        const sourceValue = variable.valuesByMode[sourceModeId];
        if (sourceValue === void 0) {
          continue;
        }
        let targetValue = sourceValue;
        if (transformColors !== void 0 && transformColors !== null && variable.resolvedType === "COLOR" && typeof sourceValue === "object") {
          const brightnessAdj = transformColors.brightness_adjustment !== void 0 ? transformColors.brightness_adjustment : 0;
          if (brightnessAdj !== 0) {
            const colorSource = sourceValue;
            targetValue = {
              r: Math.max(0, Math.min(1, colorSource.r + brightnessAdj)),
              g: Math.max(0, Math.min(1, colorSource.g + brightnessAdj)),
              b: Math.max(0, Math.min(1, colorSource.b + brightnessAdj)),
              a: colorSource.a !== void 0 ? colorSource.a : 1
            };
            transformed++;
          }
        }
        variable.setValueForMode(targetModeId, targetValue);
        copied++;
      } catch (error) {
        debugLog(`Error copying variable ${variable.name}:`, error);
      }
    }
    return {
      collectionId: collection.id,
      collectionName: collection.name,
      sourceMode,
      targetMode,
      variablesCopied: copied,
      variablesTransformed: transformed,
      success: true
    };
  }

  // src/claude_mcp_plugin/handlers/layout.ts
  async function findCollection2(collectionIdOrName) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let collection = collections.find((c) => c.id === collectionIdOrName);
    if (!collection) {
      collection = collections.find((c) => c.name === collectionIdOrName);
    }
    if (!collection) {
      throw new Error(`Collection not found: ${collectionIdOrName}`);
    }
    return collection;
  }
  async function createSpacingSystem(params) {
    const collection_id = params["collection_id"];
    const preset = params["preset"];
    const collection = await findCollection2(collection_id);
    const presets = {
      "8pt": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128, 40: 160, 48: 192, 56: 224, 64: 256 },
      "4pt": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 9: 36, 10: 40, 11: 44, 12: 48, 14: 56, 16: 64, 20: 80, 24: 96, 28: 112, 32: 128 },
      "tailwind": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128, 40: 160, 48: 192, 64: 256 },
      "material": { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 }
    };
    const spacingValues = preset !== null && preset !== void 0 && presets[preset] ? presets[preset] : presets["8pt"];
    const variables = [];
    for (const [key, value] of Object.entries(spacingValues)) {
      const variable = figma.variables.createVariable(`spacing/${key}`, collection, "FLOAT");
      const mode = collection.modes[0];
      variable.setValueForMode(mode.modeId, value);
      variables.push(`spacing/${key}`);
    }
    return {
      success: true,
      primitiveCount: variables.length,
      primitiveVariables: variables,
      preset
    };
  }
  async function createTypographySystem(params) {
    const collection_id = params["collection_id"];
    const scale_preset = params["scale_preset"];
    const base_size = params["base_size"];
    const include_weights = params["include_weights"];
    const include_line_heights = params["include_line_heights"];
    const collection = await findCollection2(collection_id);
    const ratios = {
      "minor-third": 1.2,
      "major-third": 1.25,
      "perfect-fourth": 1.333
    };
    const ratio = scale_preset !== null && scale_preset !== void 0 && ratios[scale_preset] ? ratios[scale_preset] : 1.25;
    const base = base_size !== null && base_size !== void 0 ? base_size : 16;
    const variables = [];
    const sizes = {
      xs: base / (ratio * ratio),
      sm: base / ratio,
      base,
      lg: base * ratio,
      xl: base * ratio * ratio,
      "2xl": base * ratio * ratio * ratio,
      "3xl": base * ratio * ratio * ratio * ratio,
      "4xl": base * ratio * ratio * ratio * ratio * ratio,
      "5xl": base * ratio * ratio * ratio * ratio * ratio * ratio
    };
    const mode = collection.modes[0];
    for (const [key, value] of Object.entries(sizes)) {
      const variable = figma.variables.createVariable(`font.size.${key}`, collection, "FLOAT");
      variable.setValueForMode(mode.modeId, Math.round(value));
      variables.push(`font.size.${key}`);
    }
    if (include_weights) {
      const weights = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
      for (const [key, value] of Object.entries(weights)) {
        const variable = figma.variables.createVariable(`font.weight.${key}`, collection, "FLOAT");
        variable.setValueForMode(mode.modeId, value);
        variables.push(`font.weight.${key}`);
      }
    }
    if (include_line_heights) {
      const lineHeights = { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 };
      for (const [key, value] of Object.entries(lineHeights)) {
        const variable = figma.variables.createVariable(`font.lineHeight.${key}`, collection, "FLOAT");
        variable.setValueForMode(mode.modeId, value);
        variables.push(`font.lineHeight.${key}`);
      }
    }
    return {
      success: true,
      totalVariables: variables.length,
      variables,
      preset: scale_preset
    };
  }
  async function createRadiusSystem(params) {
    const collection_id = params["collection_id"];
    const preset = params["preset"];
    const collection = await findCollection2(collection_id);
    const presets = {
      standard: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, "2xl": 24, "3xl": 32, full: 9999 },
      subtle: { none: 0, sm: 2, md: 4, lg: 6, xl: 8, "2xl": 12, "3xl": 16, full: 9999 },
      bold: { none: 0, sm: 8, md: 16, lg: 24, xl: 32, "2xl": 48, "3xl": 64, full: 9999 }
    };
    const radiusValues = preset !== null && preset !== void 0 && presets[preset] ? presets[preset] : presets["standard"];
    const variables = [];
    const mode = collection.modes[0];
    for (const [key, value] of Object.entries(radiusValues)) {
      const variable = figma.variables.createVariable(`radius/${key}`, collection, "FLOAT");
      variable.setValueForMode(mode.modeId, value);
      variables.push(`radius/${key}`);
    }
    return {
      success: true,
      totalVariables: variables.length,
      variables,
      preset
    };
  }
  function isAutoLayoutNode(node) {
    return node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "COMPONENT_SET";
  }
  async function setLayoutMode(params) {
    const nodeId = params["nodeId"];
    const layoutMode = params["layoutMode"];
    const layoutWrap = params["layoutWrap"];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (!isAutoLayoutNode(node)) {
      throw new Error(`Node "${node.name}" does not support auto layout (type: ${node.type})`);
    }
    node.layoutMode = layoutMode;
    if (layoutWrap !== void 0) {
      node.layoutWrap = layoutWrap;
    }
    return {
      nodeId: node.id,
      nodeName: node.name,
      layoutMode: node.layoutMode,
      layoutWrap: node.layoutWrap,
      success: true
    };
  }
  async function setPadding(params) {
    const nodeId = params["nodeId"];
    const paddingTop = params["paddingTop"];
    const paddingRight = params["paddingRight"];
    const paddingBottom = params["paddingBottom"];
    const paddingLeft = params["paddingLeft"];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (!isAutoLayoutNode(node)) {
      throw new Error(`Node "${node.name}" does not support padding (type: ${node.type})`);
    }
    const frame = node;
    if (paddingTop !== void 0) frame.paddingTop = paddingTop;
    if (paddingRight !== void 0) frame.paddingRight = paddingRight;
    if (paddingBottom !== void 0) frame.paddingBottom = paddingBottom;
    if (paddingLeft !== void 0) frame.paddingLeft = paddingLeft;
    return {
      nodeId: node.id,
      nodeName: node.name,
      paddingTop: frame.paddingTop,
      paddingRight: frame.paddingRight,
      paddingBottom: frame.paddingBottom,
      paddingLeft: frame.paddingLeft,
      success: true
    };
  }
  async function setItemSpacing(params) {
    const nodeId = params["nodeId"];
    const itemSpacing = params["itemSpacing"];
    const counterAxisSpacing = params["counterAxisSpacing"];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (!isAutoLayoutNode(node)) {
      throw new Error(`Node "${node.name}" does not support item spacing (type: ${node.type})`);
    }
    const frame = node;
    if (itemSpacing !== void 0) frame.itemSpacing = itemSpacing;
    if (counterAxisSpacing !== void 0) frame.counterAxisSpacing = counterAxisSpacing;
    return {
      nodeId: node.id,
      nodeName: node.name,
      itemSpacing: frame.itemSpacing,
      counterAxisSpacing: frame.counterAxisSpacing,
      success: true
    };
  }
  async function setAxisAlign(params) {
    const nodeId = params["nodeId"];
    const primaryAxisAlignItems = params["primaryAxisAlignItems"];
    const counterAxisAlignItems = params["counterAxisAlignItems"];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (!isAutoLayoutNode(node)) {
      throw new Error(`Node "${node.name}" does not support axis alignment (type: ${node.type})`);
    }
    const frame = node;
    if (primaryAxisAlignItems !== void 0) {
      frame.primaryAxisAlignItems = primaryAxisAlignItems;
    }
    if (counterAxisAlignItems !== void 0) {
      frame.counterAxisAlignItems = counterAxisAlignItems;
    }
    return {
      nodeId: node.id,
      nodeName: node.name,
      primaryAxisAlignItems: frame.primaryAxisAlignItems,
      counterAxisAlignItems: frame.counterAxisAlignItems,
      success: true
    };
  }
  async function setLayoutSizing(params) {
    const nodeId = params["nodeId"];
    const layoutSizingHorizontal = params["layoutSizingHorizontal"];
    const layoutSizingVertical = params["layoutSizingVertical"];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE" && node.type !== "COMPONENT_SET" && node.type !== "TEXT") {
      throw new Error(`Node "${node.name}" does not support layout sizing (type: ${node.type})`);
    }
    const sizingNode = node;
    if (layoutSizingHorizontal !== void 0) {
      sizingNode.layoutSizingHorizontal = layoutSizingHorizontal;
    }
    if (layoutSizingVertical !== void 0) {
      sizingNode.layoutSizingVertical = layoutSizingVertical;
    }
    return {
      nodeId: node.id,
      nodeName: node.name,
      layoutSizingHorizontal: sizingNode.layoutSizingHorizontal,
      layoutSizingVertical: sizingNode.layoutSizingVertical,
      success: true
    };
  }

  // src/claude_mcp_plugin/handlers/selection.ts
  async function setFocus(params) {
    const nodeId = params["nodeId"];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      focused: true,
      success: true
    };
  }
  async function setSelections(params) {
    const nodeIds = params["nodeIds"];
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      throw new Error("nodeIds must be a non-empty array");
    }
    const nodes = [];
    for (const id of nodeIds) {
      const node = await figma.getNodeByIdAsync(id);
      if (node) {
        nodes.push(node);
      }
    }
    if (nodes.length === 0) {
      throw new Error("No valid nodes found with provided IDs");
    }
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
    return {
      selectedCount: nodes.length,
      selectedNodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type
      })),
      success: true
    };
  }
  async function readMyDesign(params) {
    const nodeId = params !== null && params !== void 0 ? params["nodeId"] : void 0;
    const depth = params !== null && params !== void 0 ? params["depth"] : void 0;
    const variableMap = /* @__PURE__ */ new Map();
    const textStyleMap = /* @__PURE__ */ new Map();
    const effectStyleMap = /* @__PURE__ */ new Map();
    const [localVarsResult, localStylesResult, localEffectsResult] = await Promise.all([
      figma.variables.getLocalVariablesAsync().catch(() => null),
      figma.getLocalTextStylesAsync().catch(() => null),
      figma.getLocalEffectStylesAsync().catch(() => null)
    ]);
    if (localVarsResult !== null) {
      for (const v of localVarsResult) {
        variableMap.set(v.id, v.name);
      }
    }
    if (localStylesResult !== null) {
      for (const s of localStylesResult) {
        textStyleMap.set(s.id, s.name);
      }
    }
    if (localEffectsResult !== null) {
      for (const s of localEffectsResult) {
        effectStyleMap.set(s.id, s.name);
      }
    }
    function colorToHex(color) {
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      if (color.a !== void 0 && color.a < 1) {
        return `rgba(${r},${g},${b},${parseFloat(color.a.toFixed(2))})`;
      }
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    function resolveBindings(node) {
      const bindings = {};
      if (!("boundVariables" in node) || !node["boundVariables"]) {
        return bindings;
      }
      const bv = node["boundVariables"];
      for (const [field, binding] of Object.entries(bv)) {
        if (!binding) continue;
        if (Array.isArray(binding)) {
          binding.forEach((b, i) => {
            if (b && b["id"]) {
              const name = variableMap.get(b["id"]);
              if (name) bindings[`${field}/${i}`] = name;
            }
          });
        } else {
          const bindingObj = binding;
          if (bindingObj["id"]) {
            const name = variableMap.get(bindingObj["id"]);
            if (name) bindings[field] = name;
          }
        }
      }
      return bindings;
    }
    function extractFills(node) {
      if (!("fills" in node) || node.fills === figma.mixed) return void 0;
      const fills = node.fills;
      if (!Array.isArray(fills) || fills.length === 0) return void 0;
      const result2 = [];
      for (const fill of fills) {
        if (fill.visible === false) continue;
        const f = { type: fill.type };
        if (fill.type === "SOLID" && fill.color) {
          f["color"] = colorToHex(fill.color);
          if (fill.opacity !== void 0 && fill.opacity !== 1) f["opacity"] = fill.opacity;
        } else if (fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL" || fill.type === "GRADIENT_ANGULAR" || fill.type === "GRADIENT_DIAMOND") {
          const gradFill = fill;
          if (gradFill.gradientStops) {
            f["gradient"] = {
              type: fill.type,
              stops: gradFill.gradientStops.map((s) => ({
                color: colorToHex(s.color),
                position: s.position
              }))
            };
          }
        } else if (fill.type === "IMAGE") {
          f["isImage"] = true;
          const imgFill = fill;
          if (imgFill.imageHash) f["imageRef"] = imgFill.imageHash;
        }
        result2.push(f);
      }
      return result2.length > 0 ? result2 : void 0;
    }
    function extractStrokes(node) {
      if (!("strokes" in node) || !Array.isArray(node.strokes) || node.strokes.length === 0) {
        return void 0;
      }
      const result2 = [];
      for (const stroke of node.strokes) {
        if (stroke.visible === false) continue;
        const s = { type: stroke.type };
        if (stroke.type === "SOLID" && stroke.color) {
          s["color"] = colorToHex(stroke.color);
          if (stroke.opacity !== void 0 && stroke.opacity !== 1) s["opacity"] = stroke.opacity;
        }
        result2.push(s);
      }
      return result2.length > 0 ? result2 : void 0;
    }
    function extractEffects(node) {
      if (!("effects" in node) || !Array.isArray(node.effects) || node.effects.length === 0) {
        return void 0;
      }
      const result2 = [];
      for (const effect of node.effects) {
        if (effect.visible === false) continue;
        const e = { type: effect.type };
        const shadowEffect = effect;
        const blurEffect = effect;
        if (shadowEffect.color) e["color"] = colorToHex(shadowEffect.color);
        if (shadowEffect.offset) e["offset"] = { x: shadowEffect.offset.x, y: shadowEffect.offset.y };
        if (blurEffect.radius !== void 0) e["radius"] = blurEffect.radius;
        if (shadowEffect.spread !== void 0) e["spread"] = shadowEffect.spread;
        result2.push(e);
      }
      return result2.length > 0 ? result2 : void 0;
    }
    function getFontWeight(style) {
      const s = style.toLowerCase();
      if (s.includes("thin") || s.includes("hairline")) return 100;
      if (s.includes("extralight") || s.includes("ultra light") || s.includes("extra light")) return 200;
      if (s.includes("light")) return 300;
      if (s.includes("medium")) return 500;
      if (s.includes("semibold") || s.includes("semi bold") || s.includes("demibold") || s.includes("demi bold")) return 600;
      if (s.includes("extrabold") || s.includes("extra bold") || s.includes("ultra bold")) return 800;
      if (s.includes("black") || s.includes("heavy")) return 900;
      if (s.includes("bold")) return 700;
      return 400;
    }
    const processNode = async (node, currentDepth) => {
      if (node.visible === false) return null;
      const info = {
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible
      };
      if ("width" in node) info["width"] = node.width;
      if ("height" in node) info["height"] = node.height;
      if ("x" in node) info["x"] = node.x;
      if ("y" in node) info["y"] = node.y;
      if ("layoutMode" in node && node.layoutMode) {
        info["layoutMode"] = node.layoutMode;
      }
      if ("layoutSizingHorizontal" in node) info["layoutSizingHorizontal"] = node.layoutSizingHorizontal;
      if ("layoutSizingVertical" in node) info["layoutSizingVertical"] = node.layoutSizingVertical;
      if ("primaryAxisAlignItems" in node) info["primaryAxisAlignItems"] = node.primaryAxisAlignItems;
      if ("counterAxisAlignItems" in node) info["counterAxisAlignItems"] = node.counterAxisAlignItems;
      if ("itemSpacing" in node && node.itemSpacing !== void 0) info["itemSpacing"] = node.itemSpacing;
      if ("counterAxisSpacing" in node && node.counterAxisSpacing !== void 0) info["counterAxisSpacing"] = node.counterAxisSpacing;
      if ("layoutWrap" in node) info["layoutWrap"] = node.layoutWrap;
      if ("paddingTop" in node) info["paddingTop"] = node.paddingTop;
      if ("paddingRight" in node) info["paddingRight"] = node.paddingRight;
      if ("paddingBottom" in node) info["paddingBottom"] = node.paddingBottom;
      if ("paddingLeft" in node) info["paddingLeft"] = node.paddingLeft;
      if ("clipsContent" in node) info["clipsContent"] = node.clipsContent;
      if ("layoutPositioning" in node) info["layoutPositioning"] = node.layoutPositioning;
      const fills = extractFills(node);
      if (fills) info["fills"] = fills;
      const strokes = extractStrokes(node);
      if (strokes) info["strokes"] = strokes;
      if ("strokeWeight" in node && "strokes" in node && node.strokes.length > 0 && node.strokeWeight !== figma.mixed) {
        info["strokeWeight"] = node.strokeWeight;
      }
      if ("cornerRadius" in node) {
        const radiusNode = node;
        if (radiusNode.cornerRadius !== figma.mixed) {
          if (radiusNode.cornerRadius > 0) info["cornerRadius"] = radiusNode.cornerRadius;
        } else {
          const rectNode = node;
          if (rectNode.topLeftRadius > 0) info["topLeftRadius"] = rectNode.topLeftRadius;
          if (rectNode.topRightRadius > 0) info["topRightRadius"] = rectNode.topRightRadius;
          if (rectNode.bottomRightRadius > 0) info["bottomRightRadius"] = rectNode.bottomRightRadius;
          if (rectNode.bottomLeftRadius > 0) info["bottomLeftRadius"] = rectNode.bottomLeftRadius;
        }
      }
      const effects = extractEffects(node);
      if (effects) info["effects"] = effects;
      const blendNode = node;
      if (blendNode["effectStyleId"] && blendNode["effectStyleId"] !== "" && blendNode["effectStyleId"] !== figma.mixed) {
        const esName = effectStyleMap.get(blendNode["effectStyleId"]);
        if (esName) info["effectStyleName"] = esName;
      }
      if (node.type === "TEXT") {
        const textNode = node;
        info["characters"] = textNode.characters;
        if (textNode.fontName !== figma.mixed) {
          info["fontFamily"] = textNode.fontName.family;
          info["fontWeight"] = getFontWeight(textNode.fontName.style);
        }
        if (textNode.fontSize !== figma.mixed) info["fontSize"] = textNode.fontSize;
        if (textNode.lineHeight !== figma.mixed && textNode.lineHeight.unit !== "AUTO") {
          const lh = textNode.lineHeight;
          info["lineHeight"] = lh.value;
          if (lh.unit === "PERCENT") info["lineHeightUnit"] = "percent";
        }
        if (textNode.letterSpacing !== figma.mixed && textNode.letterSpacing.value !== 0) {
          info["letterSpacing"] = textNode.letterSpacing.value;
          if (textNode.letterSpacing.unit === "PERCENT") info["letterSpacingUnit"] = "percent";
        }
        if (textNode.textAlignHorizontal) info["textAlignHorizontal"] = textNode.textAlignHorizontal;
        if (textNode.textCase !== figma.mixed && textNode.textCase !== "ORIGINAL") {
          info["textCase"] = textNode.textCase;
        }
        if (textNode.textDecoration !== figma.mixed && textNode.textDecoration !== "NONE") {
          info["textDecoration"] = textNode.textDecoration;
        }
        if (textNode.textStyleId && textNode.textStyleId !== "" && textNode.textStyleId !== figma.mixed) {
          const styleName = textStyleMap.get(textNode.textStyleId);
          if (styleName) info["textStyleName"] = styleName;
        }
      }
      if ("opacity" in node && node.opacity !== void 0 && node.opacity !== 1) {
        info["opacity"] = node.opacity;
      }
      if ("rotation" in node && node.rotation !== 0) {
        info["rotation"] = node.rotation;
      }
      const bindings = resolveBindings(node);
      if (Object.keys(bindings).length > 0) info["bindings"] = bindings;
      if (node.type === "COMPONENT_SET") {
        const csNode = node;
        if (csNode.componentPropertyDefinitions) {
          const defs = {};
          for (const [key, def] of Object.entries(csNode.componentPropertyDefinitions)) {
            const cleanKey = key.replace(/#[\d:]+$/, "");
            if (def.type === "VARIANT") {
              defs[cleanKey] = { type: "VARIANT", options: def.variantOptions !== null && def.variantOptions !== void 0 ? def.variantOptions : [] };
            } else if (def.type === "BOOLEAN") {
              defs[cleanKey] = { type: "BOOLEAN", default: def.defaultValue };
            } else if (def.type === "TEXT") {
              defs[cleanKey] = { type: "TEXT", default: def.defaultValue };
            } else if (def.type === "INSTANCE_SWAP") {
              defs[cleanKey] = { type: "INSTANCE_SWAP" };
            }
          }
          if (Object.keys(defs).length > 0) info["componentPropertyDefinitions"] = defs;
        }
      } else if (node.type === "COMPONENT") {
        const compNode = node;
        if (compNode.parent && compNode.parent.type === "COMPONENT_SET") {
          info["componentSetName"] = compNode.parent.name;
          const variantProps = {};
          const parts = compNode.name.split(",");
          for (const part of parts) {
            const eqIdx = part.indexOf("=");
            if (eqIdx !== -1) {
              const k = part.substring(0, eqIdx).trim();
              const v = part.substring(eqIdx + 1).trim();
              if (k) variantProps[k] = v;
            }
          }
          if (Object.keys(variantProps).length > 0) info["variantProperties"] = variantProps;
        }
      } else if (node.type === "INSTANCE") {
        const instanceNode = node;
        if (instanceNode.componentProperties) {
          const props = {};
          for (const [key, prop] of Object.entries(instanceNode.componentProperties)) {
            const cleanKey = key.replace(/#[\d:]+$/, "");
            props[cleanKey] = { type: prop.type, value: prop.value };
          }
          if (Object.keys(props).length > 0) info["componentProperties"] = props;
        }
        try {
          const mainComp = await instanceNode.getMainComponentAsync();
          if (mainComp) {
            if (mainComp.parent && mainComp.parent.type === "COMPONENT_SET") {
              info["mainComponentName"] = mainComp.parent.name;
            } else {
              info["mainComponentName"] = mainComp.name;
            }
          }
        } catch (e) {
        }
      }
      if ("children" in node && node.children.length > 0) {
        if (depth === void 0 || currentDepth < depth) {
          const childResults = await Promise.all(
            node.children.map(
              (child) => processNode(child, currentDepth + 1)
            )
          );
          const childInfos = childResults.filter(
            (c) => c !== null
          );
          if (childInfos.length > 0) info["children"] = childInfos;
        }
      }
      return info;
    };
    const nodeIds = params !== null && params !== void 0 ? params["nodeIds"] : void 0;
    let nodesToProcess;
    if (nodeIds && Array.isArray(nodeIds) && nodeIds.length > 0) {
      nodesToProcess = [];
      for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node) nodesToProcess.push(node);
      }
      if (nodesToProcess.length === 0) throw new Error("None of the provided node IDs were found");
    } else if (nodeId) {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node with ID ${nodeId} not found`);
      nodesToProcess = [node];
    } else {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        throw new Error("No nodes selected. Please select nodes in Figma first.");
      }
      nodesToProcess = selection;
    }
    const result = [];
    for (const node of nodesToProcess) {
      const processed = await processNode(node, 0);
      if (processed) result.push(processed);
    }
    return {
      selectionCount: nodesToProcess.length,
      selection: result
    };
  }
  async function scanNodesByTypes(params) {
    const nodeId = params["nodeId"];
    const types = params["types"];
    const topLevelOnly = params["topLevelOnly"] !== void 0 && params["topLevelOnly"] !== null ? params["topLevelOnly"] : true;
    if (!Array.isArray(types) || types.length === 0) {
      throw new Error("types must be a non-empty array");
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    const results = [];
    const scanNode2 = (n, depth) => {
      const matched = types.includes(n.type);
      if (matched) {
        const nodeInfo = {
          id: n.id,
          name: n.name,
          type: n.type,
          depth
        };
        if (n.x !== void 0) nodeInfo["x"] = n.x;
        if (n.y !== void 0) nodeInfo["y"] = n.y;
        if (n.width !== void 0) nodeInfo["width"] = n.width;
        if (n.height !== void 0) nodeInfo["height"] = n.height;
        results.push(nodeInfo);
      }
      if (topLevelOnly && matched) return;
      if ("children" in n) {
        for (const child of n.children) {
          scanNode2(child, depth + 1);
        }
      }
    };
    if ("children" in node) {
      for (const child of node.children) {
        scanNode2(child, 0);
      }
    }
    return {
      success: true,
      count: results.length,
      matchingNodes: results,
      searchedTypes: types
    };
  }

  // src/claude_mcp_plugin/handlers/annotations.ts
  var ANNOTATION_SUPPORTED_TYPES = [
    "COMPONENT",
    "COMPONENT_SET",
    "ELLIPSE",
    "FRAME",
    "INSTANCE",
    "LINE",
    "POLYGON",
    "RECTANGLE",
    "STAR",
    "TEXT",
    "VECTOR"
  ];
  var ANNOTATION_VALID_COLORS = ["blue", "green", "yellow", "orange", "red", "purple", "gray", "teal"];
  function isAnnotationSupported(node) {
    return ANNOTATION_SUPPORTED_TYPES.includes(node.type);
  }
  async function getAnnotations(params) {
    const nodeId = params["nodeId"];
    const includeCategories = params["includeCategories"];
    const targetNode = await figma.getNodeByIdAsync(nodeId);
    if (!targetNode) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (!isAnnotationSupported(targetNode)) {
      return {
        success: true,
        nodeId: targetNode.id,
        nodeName: targetNode.name,
        nodeType: targetNode.type,
        annotationCount: 0,
        annotations: [],
        message: `Node type ${targetNode.type} does not support annotations`
      };
    }
    const annotatedNode = targetNode;
    const rawAnnotations = Array.from(annotatedNode.annotations) || [];
    const annotations = [];
    for (let i = 0; i < rawAnnotations.length; i++) {
      const ann = rawAnnotations[i];
      const entry = {
        index: i,
        label: ann.label !== null && ann.label !== void 0 ? ann.label : "",
        labelMarkdown: ann.labelMarkdown !== null && ann.labelMarkdown !== void 0 ? ann.labelMarkdown : ""
      };
      if (ann.categoryId) {
        entry["categoryId"] = ann.categoryId;
        if (includeCategories) {
          try {
            const category = await figma.annotations.getAnnotationCategoryByIdAsync(ann.categoryId);
            if (category) {
              entry["category"] = {
                id: category.id,
                label: category.label,
                color: category.color,
                isPreset: category.isPreset
              };
            }
          } catch (e) {
          }
        }
      }
      if (ann.properties && ann.properties.length > 0) {
        entry["properties"] = ann.properties;
      }
      annotations.push(entry);
    }
    return {
      success: true,
      nodeId: targetNode.id,
      nodeName: targetNode.name,
      nodeType: targetNode.type,
      annotationCount: annotations.length,
      annotations
    };
  }
  async function setAnnotation(params) {
    const nodeId = params["nodeId"];
    const labelMarkdown = params["labelMarkdown"];
    const categoryId = params["categoryId"];
    const properties = params["properties"];
    const annotationId = params["annotationId"];
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found`);
    }
    if (!isAnnotationSupported(node)) {
      throw new Error(`Node type ${node.type} does not support annotations. Supported types: ${ANNOTATION_SUPPORTED_TYPES.join(", ")}`);
    }
    const annotation = {
      labelMarkdown: labelMarkdown !== null && labelMarkdown !== void 0 ? labelMarkdown : ""
    };
    if (categoryId) {
      annotation["categoryId"] = categoryId;
    }
    if (properties && Array.isArray(properties) && properties.length > 0) {
      annotation["properties"] = properties;
    }
    const annotatedNode = node;
    const rawAnnotations = Array.from(annotatedNode.annotations) || [];
    const existingAnnotations = rawAnnotations.map((a) => {
      const copy = {
        labelMarkdown: a.labelMarkdown !== null && a.labelMarkdown !== void 0 ? a.labelMarkdown : ""
      };
      if (a.categoryId) copy["categoryId"] = a.categoryId;
      if (a.properties) {
        copy["properties"] = a.properties.map((p) => Object.assign({}, p));
      }
      return copy;
    });
    let annotationIndex;
    if (annotationId !== void 0 && annotationId !== null) {
      const idx = parseInt(String(annotationId), 10);
      if (isNaN(idx) || idx < 0 || idx >= existingAnnotations.length) {
        const rangeMsg = existingAnnotations.length === 0 ? "no annotations exist on this node" : `valid range: 0-${existingAnnotations.length - 1}`;
        throw new Error(`Invalid annotation index ${annotationId}. ${rangeMsg}`);
      }
      existingAnnotations[idx] = annotation;
      annotationIndex = idx;
    } else {
      annotationIndex = existingAnnotations.length;
      existingAnnotations.push(annotation);
    }
    annotatedNode["annotations"] = existingAnnotations;
    return {
      success: true,
      nodeId: node.id,
      nodeName: node.name,
      annotationIndex,
      totalAnnotations: existingAnnotations.length,
      annotation
    };
  }
  async function setMultipleAnnotations(params) {
    const annotations = params["annotations"];
    if (!Array.isArray(annotations)) {
      throw new Error("annotations must be an array");
    }
    const results = [];
    let applied = 0;
    let failed = 0;
    for (const entry of annotations) {
      try {
        const result = await setAnnotation({
          nodeId: entry["nodeId"],
          labelMarkdown: entry["labelMarkdown"],
          categoryId: entry["categoryId"],
          properties: entry["properties"],
          annotationId: entry["annotationId"]
        });
        results.push({ success: true, nodeId: entry["nodeId"], annotationIndex: result["annotationIndex"] });
        applied++;
      } catch (e) {
        const err = e;
        results.push({ success: false, nodeId: entry["nodeId"], error: err.message !== null && err.message !== void 0 ? err.message : String(e) });
        failed++;
      }
    }
    return {
      success: failed === 0,
      annotationsApplied: applied,
      annotationsFailed: failed,
      completedInChunks: 1,
      results
    };
  }
  async function getAnnotationCategories() {
    const categories = await figma.annotations.getAnnotationCategoriesAsync();
    return {
      success: true,
      count: categories.length,
      categories: categories.map((c) => ({
        id: c.id,
        label: c.label,
        color: c.color,
        isPreset: c.isPreset
      }))
    };
  }
  async function createAnnotationCategory(params) {
    const label = params["label"];
    const color = params["color"];
    if (!label || typeof label !== "string" || label.trim() === "") {
      throw new Error("label is required and must be a non-empty string");
    }
    const categoryColor = color !== null && color !== void 0 ? color : "blue";
    if (!ANNOTATION_VALID_COLORS.includes(categoryColor)) {
      throw new Error(`Invalid color "${categoryColor}". Valid colors: ${ANNOTATION_VALID_COLORS.join(", ")}`);
    }
    const category = await figma.annotations.addAnnotationCategoryAsync({
      label: label.trim(),
      color: categoryColor
    });
    return {
      success: true,
      category: {
        id: category.id,
        label: category.label,
        color: category.color,
        isPreset: category.isPreset
      }
    };
  }
  async function updateAnnotationCategory(params) {
    const categoryId = params["categoryId"];
    const label = params["label"];
    const color = params["color"];
    if (!categoryId) {
      throw new Error("categoryId is required");
    }
    const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
    if (!category) {
      throw new Error(`Annotation category with ID ${categoryId} not found`);
    }
    if (category.isPreset) {
      throw new Error("Cannot modify a preset annotation category");
    }
    if (label !== void 0 && label !== null) {
      if (typeof label !== "string" || label.trim() === "") {
        throw new Error("label must be a non-empty string");
      }
      category.setLabel(label.trim());
    }
    if (color !== void 0 && color !== null) {
      if (!ANNOTATION_VALID_COLORS.includes(color)) {
        throw new Error(`Invalid color "${color}". Valid colors: ${ANNOTATION_VALID_COLORS.join(", ")}`);
      }
      category.setColor(color);
    }
    return {
      success: true,
      category: {
        id: category.id,
        label: category.label,
        color: category.color,
        isPreset: category.isPreset
      }
    };
  }
  async function deleteAnnotationCategory(params) {
    const categoryId = params["categoryId"];
    if (!categoryId) {
      throw new Error("categoryId is required");
    }
    const category = await figma.annotations.getAnnotationCategoryByIdAsync(categoryId);
    if (!category) {
      throw new Error(`Annotation category with ID ${categoryId} not found`);
    }
    if (category.isPreset) {
      throw new Error("Cannot delete a preset annotation category");
    }
    category.remove();
    return {
      success: true,
      deletedCategoryId: categoryId
    };
  }

  // src/claude_mcp_plugin/handlers/design-system.ts
  function expandHex(hex) {
    if (hex.length === 3) {
      return hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return hex;
  }
  function parseColor(colorStr) {
    if (!colorStr) return { r: 0, g: 0, b: 0 };
    if (colorStr.indexOf("rgba") === 0) {
      const m = colorStr.match(
        /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/
      );
      if (m) {
        return {
          r: parseInt(m[1]) / 255,
          g: parseInt(m[2]) / 255,
          b: parseInt(m[3]) / 255
        };
      }
    }
    if (colorStr.indexOf("rgb") === 0) {
      const m = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (m) {
        return {
          r: parseInt(m[1]) / 255,
          g: parseInt(m[2]) / 255,
          b: parseInt(m[3]) / 255
        };
      }
    }
    const hex = expandHex(colorStr.replace("#", ""));
    return {
      r: parseInt(hex.substring(0, 2), 16) / 255,
      g: parseInt(hex.substring(2, 4), 16) / 255,
      b: parseInt(hex.substring(4, 6), 16) / 255
    };
  }
  function parseOpacity(colorStr) {
    if (!colorStr) return 1;
    if (colorStr.indexOf("rgba") === 0) {
      const m = colorStr.match(
        /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/
      );
      if (m) return parseFloat(m[4]);
    }
    return 1;
  }
  function buildFigmaPaint(fillData) {
    const gradient = fillData["gradient"];
    if (gradient) {
      const rawStops = gradient["stops"] || [];
      const stops = rawStops.map((s) => {
        const color2 = s["color"];
        return {
          color: Object.assign(parseColor(color2), { a: parseOpacity(color2) }),
          position: s["position"]
        };
      });
      return {
        type: gradient["type"],
        gradientStops: stops,
        gradientTransform: [[1, 0, 0], [0, 1, 0]],
        visible: true
      };
    }
    if (fillData["isImage"]) {
      const paint = {
        type: "IMAGE",
        visible: true,
        scaleMode: "FILL"
      };
      if (fillData["imageRef"]) {
        paint["imageHash"] = fillData["imageRef"];
      }
      return paint;
    }
    const color = fillData["color"];
    const solidPaint = {
      type: "SOLID",
      color: parseColor(color),
      visible: true
    };
    const opacity = fillData["opacity"];
    if (opacity !== void 0 && opacity < 1) {
      solidPaint["opacity"] = opacity;
    }
    return solidPaint;
  }
  function buildFigmaEffect(effectData) {
    const type = effectData["type"];
    if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
      const colorStr = effectData["color"];
      const color = colorStr ? Object.assign(parseColor(colorStr), { a: parseOpacity(colorStr) }) : { r: 0, g: 0, b: 0, a: 0.25 };
      const rawOffset = effectData["offset"];
      return {
        type,
        color,
        offset: rawOffset !== void 0 ? { x: rawOffset["x"] !== void 0 ? rawOffset["x"] : 0, y: rawOffset["y"] !== void 0 ? rawOffset["y"] : 0 } : { x: 0, y: 0 },
        radius: effectData["radius"] !== void 0 ? effectData["radius"] : 0,
        spread: effectData["spread"] !== void 0 ? effectData["spread"] : 0,
        visible: effectData["visible"] !== void 0 ? effectData["visible"] : true,
        blendMode: effectData["blendMode"] !== void 0 ? effectData["blendMode"] : "NORMAL"
      };
    }
    if (type === "LAYER_BLUR" || type === "BACKGROUND_BLUR") {
      return {
        type,
        radius: effectData["radius"] !== void 0 ? effectData["radius"] : 0,
        visible: effectData["visible"] !== void 0 ? effectData["visible"] : true
      };
    }
    const effect = { type, visible: true };
    if (effectData["radius"] !== void 0) effect["radius"] = effectData["radius"];
    if (effectData["offset"]) {
      const off = effectData["offset"];
      effect["offset"] = { x: off["x"], y: off["y"] };
    }
    if (effectData["spread"] !== void 0) effect["spread"] = effectData["spread"];
    if (effectData["color"]) {
      const colorStr = effectData["color"];
      effect["color"] = Object.assign(parseColor(colorStr), { a: parseOpacity(colorStr) });
    }
    if (effectData["blendMode"]) effect["blendMode"] = effectData["blendMode"];
    return effect;
  }
  function buildValidStyleEffect2(effect) {
    if (!effect["type"]) {
      throw new Error("Each effect must have a type property");
    }
    switch (effect["type"]) {
      case "DROP_SHADOW":
      case "INNER_SHADOW":
        return {
          type: effect["type"],
          color: effect["color"] || { r: 0, g: 0, b: 0, a: 0.5 },
          offset: effect["offset"] || { x: 0, y: 0 },
          radius: effect["radius"] !== void 0 ? effect["radius"] : 5,
          spread: effect["spread"] !== void 0 ? effect["spread"] : 0,
          visible: effect["visible"] !== void 0 ? effect["visible"] : true,
          blendMode: effect["blendMode"] !== void 0 ? effect["blendMode"] : "NORMAL"
        };
      case "LAYER_BLUR":
      case "BACKGROUND_BLUR":
        return {
          type: effect["type"],
          radius: effect["radius"] !== void 0 ? effect["radius"] : 5,
          visible: effect["visible"] !== void 0 ? effect["visible"] : true
        };
      default:
        throw new Error(
          "Unsupported effect type for style: " + String(effect["type"]) + ". Supported: DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR"
        );
    }
  }
  async function setCharacters2(node, characters) {
    try {
      node.characters = characters;
    } catch (e) {
      console.warn("setCharacters: failed to set characters:", e);
    }
  }
  async function createFromData(params) {
    const data = params["data"];
    const parentId = params["parentId"];
    const nextToId = params["nextToId"];
    const xParam = params["x"];
    const yParam = params["y"];
    const replaceChildren = params["replaceChildren"] !== void 0 ? params["replaceChildren"] : false;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("create_from_data requires a non-empty 'data' array");
    }
    const varNameMap = /* @__PURE__ */ new Map();
    try {
      const localVars = await figma.variables.getLocalVariablesAsync();
      for (const v of localVars) {
        varNameMap.set(v.name, v);
      }
    } catch (e) {
      console.warn("Failed to load local variables:", e);
    }
    const textStyleMap = /* @__PURE__ */ new Map();
    try {
      const localStyles = await figma.getLocalTextStylesAsync();
      for (const s of localStyles) {
        textStyleMap.set(s.name, s);
      }
    } catch (e) {
      console.warn("Failed to load local text styles:", e);
    }
    const effectStyleMap = /* @__PURE__ */ new Map();
    try {
      const localEffects = await figma.getLocalEffectStylesAsync();
      for (const s of localEffects) {
        effectStyleMap.set(s.name, s);
      }
    } catch (e) {
      console.warn("Failed to load local effect styles:", e);
    }
    let parent;
    if (parentId) {
      const resolved = await figma.getNodeByIdAsync(parentId);
      if (!resolved || !("appendChild" in resolved)) {
        throw new Error("Invalid parent node: " + parentId);
      }
      parent = resolved;
    } else {
      parent = figma.currentPage;
    }
    const GAP = 100;
    let resolvedX = xParam;
    let resolvedY = yParam;
    if (nextToId) {
      const refNode = await figma.getNodeByIdAsync(nextToId);
      if (!refNode) {
        throw new Error("nextToId node not found: " + nextToId);
      }
      const ref = refNode;
      resolvedX = ref.x + ref.width + GAP;
      resolvedY = ref.y;
    } else if (resolvedX === void 0 && resolvedY === void 0 && !parentId) {
      const children = parent.children;
      if (children.length > 0) {
        let maxRight = -Infinity;
        let topY = Infinity;
        for (const child of children) {
          const layout = child;
          const right = layout.x + layout.width;
          if (right > maxRight) maxRight = right;
          if (layout.y < topY) topY = layout.y;
        }
        resolvedX = maxRight + GAP;
        resolvedY = topY;
      } else {
        resolvedX = 0;
        resolvedY = 0;
      }
    }
    const createdNodes = [];
    const componentLookup = /* @__PURE__ */ new Map();
    const allPageComponents = figma.currentPage.findAll(
      (n) => n.type === "COMPONENT"
    );
    for (const comp of allPageComponents) {
      componentLookup.set(comp.name, comp);
      if (comp.parent && comp.parent.type === "COMPONENT_SET") {
        if (!componentLookup.has(comp.parent.name)) {
          componentLookup.set(comp.parent.name, comp);
        }
      }
    }
    async function createNode(nodeData, parentNode, isRoot, rootX, rootY) {
      let node = null;
      let isUpdate = false;
      let skipChildRecursion = false;
      if (nodeData["id"]) {
        try {
          const existing = await figma.getNodeByIdAsync(
            nodeData["id"]
          );
          if (existing) {
            const existingScene = existing;
            const existingType = existingScene.type;
            const jsxType2 = nodeData["type"];
            const isTypeCompatible = existingType === jsxType2 || jsxType2 === "FRAME" && existingType === "COMPONENT" || jsxType2 === "FRAME" && existingType === "INSTANCE" || jsxType2 === "COMPONENT" && existingType === "FRAME";
            if (jsxType2 === "COMPONENT_SET") {
              console.warn(
                'Cannot update COMPONENT_SET "' + String(existingScene.name) + '" in-place \u2014 creating new node'
              );
            } else if (jsxType2 === "SVG") {
              console.warn(
                'Cannot update SVG node "' + String(existingScene.name) + '" in-place \u2014 creating new node'
              );
            } else if (!isTypeCompatible) {
              console.warn(
                'Type mismatch: JSX type "' + jsxType2 + '" does not match existing node type "' + existingType + '" for id "' + String(nodeData["id"]) + '" \u2014 creating new node'
              );
            } else {
              node = existingScene;
              isUpdate = true;
              if (replaceChildren && "children" in node) {
                const withChildren = node;
                for (let i = withChildren.children.length - 1; i >= 0; i--) {
                  withChildren.children[i].remove();
                }
              }
              if (existing.type === "TEXT") {
                const textNode = existing;
                const family = nodeData["fontFamily"] !== void 0 ? nodeData["fontFamily"] : "Inter";
                const weight = nodeData["fontWeight"] !== void 0 ? nodeData["fontWeight"] : 400;
                try {
                  await figma.loadFontAsync({
                    family,
                    style: getFontStyle(weight)
                  });
                  textNode.fontName = { family, style: getFontStyle(weight) };
                } catch (e) {
                  try {
                    await figma.loadFontAsync({
                      family: "Inter",
                      style: "Regular"
                    });
                    textNode.fontName = {
                      family: "Inter",
                      style: "Regular"
                    };
                  } catch (e2) {
                    console.warn(
                      "Failed to load fallback font Inter Regular:",
                      e2
                    );
                  }
                }
                if (nodeData["characters"]) {
                  await setCharacters2(
                    textNode,
                    nodeData["characters"]
                  );
                }
              }
            }
          }
        } catch (e) {
          console.warn(
            'Could not find node with id "' + String(nodeData["id"]) + '" \u2014 creating new node'
          );
        }
      }
      const jsxType = nodeData["type"];
      if (node === null && jsxType === "TEXT") {
        const textNode = figma.createText();
        const family = nodeData["fontFamily"] !== void 0 ? nodeData["fontFamily"] : "Inter";
        const weight = nodeData["fontWeight"] !== void 0 ? nodeData["fontWeight"] : 400;
        try {
          await figma.loadFontAsync({ family, style: getFontStyle(weight) });
          textNode.fontName = { family, style: getFontStyle(weight) };
        } catch (e) {
          try {
            await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            textNode.fontName = { family: "Inter", style: "Regular" };
          } catch (e2) {
            console.warn("Failed to load fallback font Inter Regular:", e2);
          }
        }
        if (nodeData["characters"]) {
          await setCharacters2(textNode, nodeData["characters"]);
        }
        node = textNode;
      } else if (node === null && jsxType === "COMPONENT") {
        const comp = figma.createComponent();
        comp.fills = [];
        node = comp;
      } else if (node === null && jsxType === "COMPONENT_SET") {
        const tempFrame = figma.createFrame();
        tempFrame.name = nodeData["name"] !== void 0 ? nodeData["name"] : "ComponentSet";
        tempFrame.fills = [];
        parentNode.appendChild(tempFrame);
        try {
          const childComponents = [];
          const childrenData2 = nodeData["children"];
          if (childrenData2 && childrenData2.length > 0) {
            for (const child of childrenData2) {
              const childNode = await createNode(
                child,
                tempFrame,
                false
              );
              if (childNode && childNode.type === "COMPONENT") {
                childComponents.push(childNode);
              }
            }
          }
          if (childComponents.length > 0) {
            const set = figma.combineAsVariants(
              childComponents,
              parentNode
            );
            set.name = nodeData["name"] !== void 0 ? nodeData["name"] : "ComponentSet";
            node = set;
          } else {
            const fallback = figma.createComponent();
            fallback.fills = [];
            parentNode.appendChild(fallback);
            node = fallback;
          }
        } finally {
          try {
            tempFrame.remove();
          } catch (_) {
          }
        }
        const propDefs = nodeData["componentPropertyDefinitions"];
        if (propDefs && node !== null && node.type === "COMPONENT_SET") {
          const setNode = node;
          for (const propName of Object.keys(propDefs)) {
            const def = propDefs[propName];
            if (def["type"] === "VARIANT") continue;
            try {
              const defaultVal = def["default"] !== void 0 ? def["default"] : def["type"] === "BOOLEAN" ? true : "";
              setNode.addComponentProperty(
                propName,
                def["type"],
                defaultVal
              );
            } catch (e) {
              console.warn(
                'Failed to add component property "' + propName + '":',
                e
              );
            }
          }
        }
        skipChildRecursion = true;
      } else if (node === null && jsxType === "INSTANCE") {
        const componentName = nodeData["mainComponentName"] !== void 0 ? nodeData["mainComponentName"] : nodeData["name"];
        const sourceComponent = componentLookup.get(componentName) !== void 0 ? componentLookup.get(componentName) : null;
        if (sourceComponent) {
          const instance = sourceComponent.createInstance();
          const compProps = nodeData["componentProperties"];
          if (compProps) {
            const propsToSet = {};
            for (const key of Object.keys(compProps)) {
              propsToSet[key] = compProps[key]["value"];
            }
            try {
              instance.setProperties(propsToSet);
            } catch (e) {
              console.warn("Failed to set instance properties:", e);
            }
          }
          node = instance;
        } else {
          const fallback = figma.createFrame();
          fallback.fills = [];
          console.warn(
            'Component "' + componentName + '" not found \u2014 created frame as fallback'
          );
          node = fallback;
        }
      } else if (node === null && jsxType === "SVG" && nodeData["svgString"]) {
        let svgCreatedFromString = false;
        let svgNode;
        try {
          svgNode = figma.createNodeFromSvg(nodeData["svgString"]);
          svgCreatedFromString = true;
        } catch (e) {
          console.warn("Failed to create SVG node, falling back to frame:", e);
          const frame = figma.createFrame();
          frame.fills = [];
          svgNode = frame;
        }
        svgNode.name = nodeData["name"] !== void 0 ? nodeData["name"] : "SVG";
        if (svgCreatedFromString) {
          const svgRootStroke = parseSvgRootStroke(
            nodeData["svgString"]
          );
          if (svgRootStroke) {
            propagateStrokeToShapes(svgNode, svgRootStroke);
            if ("strokes" in svgNode) {
              svgNode.strokes = [];
            }
          }
        }
        if (svgNode.parent !== parentNode) {
          parentNode.appendChild(svgNode);
        }
        if (isRoot && rootX !== void 0) svgNode.x = rootX;
        if (isRoot && rootY !== void 0) svgNode.y = rootY;
        if (nodeData["width"] !== void 0 && nodeData["height"] !== void 0) {
          svgNode.resize(
            nodeData["width"],
            nodeData["height"]
          );
        }
        return svgNode;
      } else if (node === null && (jsxType === "RECTANGLE" || jsxType === "VECTOR" || jsxType === "LINE")) {
        node = figma.createRectangle();
      } else if (node === null) {
        const frame = figma.createFrame();
        frame.fills = [];
        node = frame;
      }
      const n = node;
      n.name = nodeData["name"] !== void 0 ? nodeData["name"] : "Node";
      if (!isUpdate && jsxType !== "COMPONENT_SET") {
        if (n.parent !== parentNode) {
          parentNode.appendChild(n);
        }
      }
      if (!isUpdate && isRoot && rootX !== void 0) {
        n.x = rootX;
      }
      if (!isUpdate && isRoot && rootY !== void 0) {
        n.y = rootY;
      }
      const layoutMode = nodeData["layoutMode"];
      if (layoutMode && layoutMode !== "NONE") {
        n.layoutMode = layoutMode;
        if (nodeData["primaryAxisAlignItems"]) {
          n.primaryAxisAlignItems = nodeData["primaryAxisAlignItems"];
        }
        if (nodeData["counterAxisAlignItems"]) {
          n.counterAxisAlignItems = nodeData["counterAxisAlignItems"];
        }
        if (nodeData["itemSpacing"] !== void 0) {
          n.itemSpacing = nodeData["itemSpacing"];
        }
        if (nodeData["counterAxisSpacing"] !== void 0) {
          n.counterAxisSpacing = nodeData["counterAxisSpacing"];
        }
        if (nodeData["layoutWrap"]) {
          n.layoutWrap = nodeData["layoutWrap"];
        }
        if (nodeData["paddingTop"] !== void 0) {
          n.paddingTop = nodeData["paddingTop"];
        }
        if (nodeData["paddingRight"] !== void 0) {
          n.paddingRight = nodeData["paddingRight"];
        }
        if (nodeData["paddingBottom"] !== void 0) {
          n.paddingBottom = nodeData["paddingBottom"];
        }
        if (nodeData["paddingLeft"] !== void 0) {
          n.paddingLeft = nodeData["paddingLeft"];
        }
      }
      if (nodeData["clipsContent"]) {
        n.clipsContent = true;
      }
      const nLayout = n;
      if (nodeData["width"] !== void 0 && nodeData["height"] !== void 0) {
        n.resize(
          nodeData["width"],
          nodeData["height"]
        );
      } else if (nodeData["width"] !== void 0) {
        n.resize(
          nodeData["width"],
          nLayout.height
        );
      } else if (nodeData["height"] !== void 0) {
        n.resize(
          nLayout.width,
          nodeData["height"]
        );
      }
      if (nodeData["layoutSizingHorizontal"]) {
        n.layoutSizingHorizontal = nodeData["layoutSizingHorizontal"];
      } else if (nodeData["layoutMode"]) {
        n.layoutSizingHorizontal = "HUG";
      }
      if (nodeData["layoutSizingVertical"]) {
        n.layoutSizingVertical = nodeData["layoutSizingVertical"];
      } else if (nodeData["layoutMode"]) {
        n.layoutSizingVertical = "HUG";
      }
      const fills = nodeData["fills"];
      if (fills && fills.length > 0) {
        n.fills = fills.map((f) => buildFigmaPaint(f));
      }
      const strokes = nodeData["strokes"];
      if (strokes && strokes.length > 0) {
        n.strokes = strokes.map((s) => buildFigmaPaint(s));
      }
      if (nodeData["strokeWeight"]) {
        n.strokeWeight = nodeData["strokeWeight"];
      }
      const hasIndividualStrokes = nodeData["strokeTopWeight"] !== void 0 || nodeData["strokeBottomWeight"] !== void 0 || nodeData["strokeLeftWeight"] !== void 0 || nodeData["strokeRightWeight"] !== void 0;
      if (hasIndividualStrokes) {
        const nGeom = n;
        nGeom.strokeTopWeight = nodeData["strokeTopWeight"] !== void 0 ? nodeData["strokeTopWeight"] : 0;
        nGeom.strokeBottomWeight = nodeData["strokeBottomWeight"] !== void 0 ? nodeData["strokeBottomWeight"] : 0;
        nGeom.strokeLeftWeight = nodeData["strokeLeftWeight"] !== void 0 ? nodeData["strokeLeftWeight"] : 0;
        nGeom.strokeRightWeight = nodeData["strokeRightWeight"] !== void 0 ? nodeData["strokeRightWeight"] : 0;
      }
      if (nodeData["cornerRadius"]) {
        n.cornerRadius = nodeData["cornerRadius"];
      }
      if (nodeData["topLeftRadius"]) {
        n.topLeftRadius = nodeData["topLeftRadius"];
      }
      if (nodeData["topRightRadius"]) {
        n.topRightRadius = nodeData["topRightRadius"];
      }
      if (nodeData["bottomRightRadius"]) {
        n.bottomRightRadius = nodeData["bottomRightRadius"];
      }
      if (nodeData["bottomLeftRadius"]) {
        n.bottomLeftRadius = nodeData["bottomLeftRadius"];
      }
      const effectsData = nodeData["effects"];
      if (effectsData && effectsData.length > 0) {
        n.effects = effectsData.map(
          (e) => buildFigmaEffect(e)
        );
      }
      if (nodeData["effectStyleName"]) {
        const eStyle = effectStyleMap.get(nodeData["effectStyleName"]);
        if (eStyle) {
          await n.setEffectStyleIdAsync(eStyle.id);
        }
      }
      if (nodeData["opacity"] !== void 0) {
        n.opacity = nodeData["opacity"];
      }
      if (nodeData["rotation"]) {
        n.rotation = nodeData["rotation"];
      }
      if (jsxType === "TEXT") {
        const textN = n;
        if (nodeData["fontSize"]) textN.fontSize = nodeData["fontSize"];
        if (nodeData["lineHeight"] !== void 0) {
          textN.lineHeight = nodeData["lineHeightUnit"] === "percent" ? { value: nodeData["lineHeight"], unit: "PERCENT" } : { value: nodeData["lineHeight"], unit: "PIXELS" };
        }
        if (nodeData["letterSpacing"] !== void 0) {
          textN.letterSpacing = nodeData["letterSpacingUnit"] === "percent" ? {
            value: nodeData["letterSpacing"],
            unit: "PERCENT"
          } : {
            value: nodeData["letterSpacing"],
            unit: "PIXELS"
          };
        }
        if (nodeData["textAlignHorizontal"]) {
          textN.textAlignHorizontal = nodeData["textAlignHorizontal"];
        }
        if (nodeData["textCase"] && nodeData["textCase"] !== "ORIGINAL") {
          textN.textCase = nodeData["textCase"];
        }
        if (nodeData["textDecoration"] && nodeData["textDecoration"] !== "NONE") {
          textN.textDecoration = nodeData["textDecoration"];
        }
        if (nodeData["textStyleName"]) {
          const style = textStyleMap.get(nodeData["textStyleName"]);
          if (style) {
            await textN.setTextStyleIdAsync(style.id);
          }
        }
      }
      if (nodeData["layoutPositioning"] === "ABSOLUTE") {
        const nParent = n.parent;
        if (nParent && "layoutMode" in nParent && nParent.layoutMode !== "NONE") {
          n.layoutPositioning = "ABSOLUTE";
        }
        if (nodeData["x"] !== void 0) {
          n.x = nodeData["x"];
        }
        if (nodeData["y"] !== void 0) {
          n.y = nodeData["y"];
        }
      }
      const bindings = nodeData["bindings"];
      if (bindings) {
        for (const field of Object.keys(bindings)) {
          const varName = bindings[field];
          const variable = varNameMap.get(varName);
          if (!variable) continue;
          if (field.indexOf("fills/") === 0 || field.indexOf("strokes/") === 0) {
            const parts = field.split("/");
            const prop = parts[0];
            const idx = parseInt(parts[1]);
            const paints = [
              ...n[prop]
            ];
            if (paints[idx]) {
              paints[idx] = figma.variables.setBoundVariableForPaint(
                paints[idx],
                "color",
                variable
              );
              n[prop] = paints;
            }
          } else {
            try {
              n.setBoundVariable(
                field,
                variable
              );
            } catch (e) {
              console.warn(
                'Failed to bind variable "' + varName + '" to field "' + field + '":',
                e
              );
            }
          }
        }
      }
      const skipChildrenForUpdate = isUpdate && !replaceChildren;
      const childrenData = nodeData["children"];
      if (!skipChildRecursion && !skipChildrenForUpdate && childrenData && childrenData.length > 0) {
        for (const child of childrenData) {
          await createNode(child, n, false);
        }
      }
      createdNodes.push({
        id: n.id,
        name: n.name,
        type: n.type,
        action: isUpdate ? "updated" : "created"
      });
      return n;
    }
    let xOffset = 0;
    for (let i = 0; i < data.length; i++) {
      const isExistingUpdate = data[i]["id"] ? await figma.getNodeByIdAsync(data[i]["id"]).catch(() => null) : null;
      const node = await createNode(
        data[i],
        parent,
        true,
        resolvedX !== void 0 ? resolvedX + xOffset : void 0,
        resolvedY
      );
      if (!isExistingUpdate) {
        xOffset += (node.width !== void 0 ? node.width : 100) + 40;
      }
    }
    return { createdNodes };
  }
  async function getDesignSystem() {
    const results = await Promise.all([
      figma.variables.getLocalVariablesAsync(),
      figma.variables.getLocalVariableCollectionsAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync()
    ]);
    const allVariables = results[0];
    const allCollections = results[1];
    const textStyles = results[2];
    const effectStyles = results[3];
    const collectionMap = {};
    for (let ci = 0; ci < allCollections.length; ci++) {
      const col = allCollections[ci];
      collectionMap[col.id] = col;
    }
    const variables = [];
    for (let vi = 0; vi < allVariables.length; vi++) {
      const v = allVariables[vi];
      const collection = collectionMap[v.variableCollectionId];
      const collectionName = collection !== void 0 ? collection.name : "";
      const modes = collection !== void 0 ? collection.modes : [];
      const values = [];
      for (let mi = 0; mi < modes.length; mi++) {
        const mode = modes[mi];
        const rawValue = v.valuesByMode[mode.modeId];
        let resolvedValue = rawValue;
        if (rawValue !== null && rawValue !== void 0 && typeof rawValue === "object" && rawValue["type"] === "VARIABLE_ALIAS") {
          const aliasId = rawValue["id"];
          const aliasVar = figma.variables.getVariableById(aliasId);
          resolvedValue = aliasVar !== null && aliasVar !== void 0 ? aliasVar.name : aliasId;
        }
        values.push({
          modeId: mode.modeId,
          modeName: mode.name,
          value: resolvedValue
        });
      }
      variables.push({
        id: v.id,
        name: v.name,
        description: v.description !== void 0 ? v.description : "",
        resolvedType: v.resolvedType,
        collectionName,
        values
      });
    }
    const mappedTextStyles = [];
    for (let ti = 0; ti < textStyles.length; ti++) {
      const ts = textStyles[ti];
      mappedTextStyles.push({
        id: ts.id,
        name: ts.name,
        fontSize: ts.fontSize,
        fontName: ts.fontName !== null && ts.fontName !== void 0 ? { family: ts.fontName.family, style: ts.fontName.style } : { family: "", style: "" },
        lineHeight: ts.lineHeight
      });
    }
    const mappedEffectStyles = [];
    for (let ei = 0; ei < effectStyles.length; ei++) {
      const es = effectStyles[ei];
      const mappedEffects = [];
      if (es.effects && es.effects.length > 0) {
        for (let efi = 0; efi < es.effects.length; efi++) {
          const eff = es.effects[efi];
          const mappedEff = {
            type: eff.type,
            visible: eff.visible
          };
          if ("color" in eff && eff.color) {
            const c = eff.color;
            mappedEff["color"] = { r: c.r, g: c.g, b: c.b, a: c.a };
          }
          if ("offset" in eff && eff.offset) {
            const off = eff.offset;
            mappedEff["offset"] = { x: off.x, y: off.y };
          }
          if ("radius" in eff && eff.radius !== void 0) {
            mappedEff["radius"] = eff.radius;
          }
          if ("spread" in eff && eff.spread !== void 0) {
            mappedEff["spread"] = eff.spread;
          }
          mappedEffects.push(mappedEff);
        }
      }
      mappedEffectStyles.push({
        id: es.id,
        name: es.name,
        description: es.description !== void 0 ? es.description : "",
        effects: mappedEffects
      });
    }
    const pages = [];
    for (let pi = 0; pi < figma.root.children.length; pi++) {
      const pg = figma.root.children[pi];
      pages.push({ id: pg.id, name: pg.name });
    }
    return {
      pages,
      variables,
      textStyles: mappedTextStyles,
      effectStyles: mappedEffectStyles
    };
  }
  async function setupDesignSystem(params) {
    const inputCollections = params !== null && params !== void 0 && Array.isArray(params["collections"]) && params["collections"].length > 0 ? params["collections"] : [];
    const inputTextStyles = params !== null && params !== void 0 && params["textStyles"] ? params["textStyles"] : [];
    const inputEffectStyles = params !== null && params !== void 0 && params["effectStyles"] ? params["effectStyles"] : [];
    const varResult = {
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
    const tsResult = {
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
    const esResult = {
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
    const createdCollections = [];
    if (inputCollections.length > 0) {
      const allLocalCollections = await figma.variables.getLocalVariableCollectionsAsync();
      const allLocalVars = await figma.variables.getLocalVariablesAsync();
      for (let colIdx = 0; colIdx < inputCollections.length; colIdx++) {
        const colDef = inputCollections[colIdx];
        const colName = colDef["name"] !== void 0 ? colDef["name"] : "Design Tokens";
        const colVars = colDef["variables"] !== void 0 && Array.isArray(colDef["variables"]) ? colDef["variables"] : [];
        let targetCollection = null;
        for (let ci = 0; ci < allLocalCollections.length; ci++) {
          if (allLocalCollections[ci].name === colName) {
            targetCollection = allLocalCollections[ci];
            break;
          }
        }
        if (!targetCollection) {
          targetCollection = figma.variables.createVariableCollection(colName);
          allLocalCollections.push(targetCollection);
        }
        createdCollections.push({
          id: targetCollection.id,
          name: colName
        });
        const defaultModeId = targetCollection.modes[0].modeId;
        const varByName = {};
        for (let evi = 0; evi < allLocalVars.length; evi++) {
          const ev = allLocalVars[evi];
          if (targetCollection !== null && ev.variableCollectionId === targetCollection.id) {
            varByName[ev.name] = ev;
          }
        }
        for (let vi = 0; vi < colVars.length; vi++) {
          const vDef = colVars[vi];
          try {
            const existing = varByName[vDef["name"]];
            if (existing) {
              existing.setValueForMode(defaultModeId, vDef["value"]);
              if (vDef["description"] !== void 0) {
                existing.description = vDef["description"];
              }
              varResult["updated"];
              varResult["updated"] = varResult["updated"] + 1;
            } else {
              const resolvedType = vDef["type"] === "COLOR" ? "COLOR" : "FLOAT";
              const newVar = figma.variables.createVariable(
                vDef["name"],
                targetCollection,
                resolvedType
              );
              newVar.setValueForMode(defaultModeId, vDef["value"]);
              if (vDef["description"] !== void 0) {
                newVar.description = vDef["description"];
              }
              varByName[vDef["name"]] = newVar;
              allLocalVars.push(newVar);
              varResult["created"] = varResult["created"] + 1;
            }
          } catch (e) {
            varResult["failed"] = varResult["failed"] + 1;
            varResult["errors"].push({
              name: colName + "/" + String(vDef["name"]),
              error: e instanceof Error ? e.message : String(e)
            });
          }
        }
      }
    }
    if (inputTextStyles.length > 0) {
      const existingTextStyles = await figma.getLocalTextStylesAsync();
      const tsByName = {};
      for (let eti = 0; eti < existingTextStyles.length; eti++) {
        tsByName[existingTextStyles[eti].name] = existingTextStyles[eti];
      }
      for (let ti = 0; ti < inputTextStyles.length; ti++) {
        const tsDef = inputTextStyles[ti];
        try {
          const fontFamily = tsDef["fontFamily"] !== void 0 ? tsDef["fontFamily"] : "Inter";
          const fontStyle = tsDef["fontStyle"] !== void 0 ? tsDef["fontStyle"] : "Regular";
          await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
          const existingTs = tsByName[tsDef["name"]];
          if (existingTs) {
            existingTs.fontName = { family: fontFamily, style: fontStyle };
            existingTs.fontSize = tsDef["fontSize"];
            if (tsDef["lineHeight"] !== void 0) {
              existingTs.lineHeight = tsDef["lineHeight"];
            }
            if (tsDef["letterSpacing"] !== void 0) {
              existingTs.letterSpacing = tsDef["letterSpacing"];
            }
            if (tsDef["description"] !== void 0) {
              existingTs.description = tsDef["description"];
            }
            tsResult["updated"] = tsResult["updated"] + 1;
          } else {
            const newTs = figma.createTextStyle();
            newTs.name = tsDef["name"];
            newTs.fontName = { family: fontFamily, style: fontStyle };
            newTs.fontSize = tsDef["fontSize"];
            if (tsDef["lineHeight"] !== void 0) {
              newTs.lineHeight = tsDef["lineHeight"];
            }
            if (tsDef["letterSpacing"] !== void 0) {
              newTs.letterSpacing = tsDef["letterSpacing"];
            }
            if (tsDef["description"] !== void 0) {
              newTs.description = tsDef["description"];
            }
            tsByName[tsDef["name"]] = newTs;
            tsResult["created"] = tsResult["created"] + 1;
          }
        } catch (e) {
          tsResult["failed"] = tsResult["failed"] + 1;
          tsResult["errors"].push({
            name: tsDef["name"],
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
    }
    if (inputEffectStyles.length > 0) {
      const existingEffectStyles = await figma.getLocalEffectStylesAsync();
      const esByName = {};
      for (let eei = 0; eei < existingEffectStyles.length; eei++) {
        esByName[existingEffectStyles[eei].name] = existingEffectStyles[eei];
      }
      for (let ei = 0; ei < inputEffectStyles.length; ei++) {
        const esDef = inputEffectStyles[ei];
        try {
          if (!esDef["effects"] || !Array.isArray(esDef["effects"]) || esDef["effects"].length === 0) {
            throw new Error("effects must be a non-empty array");
          }
          const validEffects = esDef["effects"].map(buildValidStyleEffect2);
          const existingEs = esByName[esDef["name"]];
          if (existingEs) {
            existingEs.effects = validEffects;
            if (esDef["description"] !== void 0) {
              existingEs.description = esDef["description"];
            }
            esResult["updated"] = esResult["updated"] + 1;
          } else {
            const newEs = figma.createEffectStyle();
            newEs.name = esDef["name"];
            newEs.effects = validEffects;
            if (esDef["description"] !== void 0) {
              newEs.description = esDef["description"];
            }
            esByName[esDef["name"]] = newEs;
            esResult["created"] = esResult["created"] + 1;
          }
        } catch (e) {
          esResult["failed"] = esResult["failed"] + 1;
          esResult["errors"].push({
            name: esDef["name"],
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
    }
    if (varResult["errors"].length === 0) {
      delete varResult["errors"];
    }
    if (tsResult["errors"].length === 0) {
      delete tsResult["errors"];
    }
    if (esResult["errors"].length === 0) {
      delete esResult["errors"];
    }
    const requiredPages = params !== null && params !== void 0 && Array.isArray(params["pages"]) && params["pages"].length > 0 ? params["pages"] : ["Screens", "Components", "Draft"];
    await figma.loadAllPagesAsync();
    const existingPages = figma.root.children;
    const existingPageNames = {};
    for (let epi = 0; epi < existingPages.length; epi++) {
      existingPageNames[existingPages[epi].name.toLowerCase()] = existingPages[epi];
    }
    const firstRequired = requiredPages[0];
    if (existingPages.length === 1 && existingPages[0].name === "Page 1" && existingPages[0].children.length === 0 && !existingPageNames[firstRequired.toLowerCase()]) {
      existingPages[0].name = firstRequired;
      existingPageNames[firstRequired.toLowerCase()] = existingPages[0];
    }
    for (let rpi = 0; rpi < requiredPages.length; rpi++) {
      const reqName = requiredPages[rpi];
      if (!existingPageNames[reqName.toLowerCase()]) {
        const newPage = figma.createPage();
        newPage.name = reqName;
        existingPageNames[reqName.toLowerCase()] = newPage;
      }
    }
    const finalPages = [];
    const allPages = figma.root.children;
    for (let fpi = 0; fpi < allPages.length; fpi++) {
      finalPages.push({ id: allPages[fpi].id, name: allPages[fpi].name });
    }
    return {
      collections: createdCollections,
      pages: finalPages,
      variables: varResult,
      textStyles: tsResult,
      effectStyles: esResult
    };
  }

  // src/claude_mcp_plugin/handlers/lint/constants.ts
  var MAX_LINT_DEPTH = 50;
  var MAX_LINT_VIOLATIONS = 500;
  var COLOR_EXACT_THRESHOLD = 5e-3;
  var COLOR_NEAR_THRESHOLD = 0.18;
  var COLOR_SEMANTIC_BONUS = 0.08;
  var COLOR_SEMANTIC_KEYWORDS = {
    backgroundFills: ["surface", "background", "bg", "fill", "base", "canvas", "card", "overlay", "panel", "container", "layer", "level"],
    iconColors: ["icon", "foreground", "fg", "on-", "content", "symbol", "glyph"],
    strokesBorders: ["stroke", "border", "outline", "divider", "separator", "line", "ring", "frame"]
  };
  var FLOAT_SEMANTIC_KEYWORDS = {
    spacing: ["spacing", "space", "gap", "padding", "margin", "indent", "inset", "gutter"],
    borderRadius: ["radius", "round", "corner", "rounded", "curve"],
    typography: ["font-size", "fontsize", "font-scale", "text-size", "size", "scale", "type"]
  };
  var DEVICE_SIZES = [
    { name: "desktop", width: 1440, minHeight: 900 },
    { name: "tablet", width: 768, minHeight: 1024 },
    { name: "mobile", width: 375, minHeight: 812 }
  ];
  var DIM_TOLERANCE = 2;

  // src/claude_mcp_plugin/handlers/lint/helpers.ts
  function isFillBound(node, propKey, idx) {
    let bv = node.boundVariables;
    if (bv) {
      let binding = bv[propKey];
      if (binding) {
        if (Array.isArray(binding)) {
          let item = binding[idx];
          if (item && item.id) return true;
        } else if (binding.id) {
          return true;
        }
      }
    }
    return false;
  }
  function isScalarBound(node, propKey) {
    let bv = node.boundVariables;
    if (bv && bv[propKey]) {
      let binding = bv[propKey];
      if (binding.id) return true;
      if (Array.isArray(binding) && binding.length > 0 && binding[0] && binding[0].id) return true;
    }
    return false;
  }
  function hasFillPaintStyle(node) {
    try {
      let styleId = node.fillStyleId;
      if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
    } catch (e) {
    }
    return false;
  }
  function hasStrokePaintStyle(node) {
    try {
      let styleId = node.strokeStyleId;
      if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
    } catch (e) {
    }
    return false;
  }
  function hasTextStyle(node) {
    try {
      let styleId = node.textStyleId;
      if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
    } catch (e) {
    }
    return false;
  }
  function hasEffectStyle(node) {
    try {
      let styleId = node.effectStyleId;
      if (styleId && styleId !== "" && styleId !== figma.mixed) return true;
    } catch (e) {
    }
    return false;
  }
  function hasFontVariableBindings(node) {
    let bv = node.boundVariables;
    if (!bv) return false;
    let fontProps = ["fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight", "letterSpacing", "paragraphSpacing"];
    for (let fi = 0; fi < fontProps.length; fi++) {
      let prop = bv[fontProps[fi]];
      if (prop && prop.id) return true;
    }
    return false;
  }
  function isIconLike(node) {
    if (node.type === "VECTOR" || node.type === "LINE" || node.type === "BOOLEAN_OPERATION") return true;
    if (node.type === "INSTANCE" || node.type === "COMPONENT") {
      try {
        let sized = node;
        if (sized.width <= 48 && sized.height <= 48) return true;
      } catch (e) {
      }
    }
    return false;
  }
  function isColorFill(fill) {
    if (!fill || fill.visible === false) return false;
    if (fill.type === "SOLID" || fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL" || fill.type === "GRADIENT_ANGULAR" || fill.type === "GRADIENT_DIAMOND") return true;
    return false;
  }
  function addViolation(violations, violationsCappedRef, maxViolations, node, depth, severity, category, property, message, details) {
    if (violations.length >= maxViolations) {
      violationsCappedRef.value = true;
      return;
    }
    let v = {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      depth,
      severity,
      category,
      property,
      message
    };
    if (details !== void 0) v.details = details;
    violations.push(v);
  }
  function colorDist(c1, c2) {
    let dr = c1.r - c2.r;
    let dg = c1.g - c2.g;
    let db = c1.b - c2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  function isSemanticMatch(nameLower, category) {
    let kws = COLOR_SEMANTIC_KEYWORDS[category];
    if (!kws) return false;
    for (let ki = 0; ki < kws.length; ki++) {
      if (nameLower.indexOf(kws[ki]) !== -1) return true;
    }
    return false;
  }
  async function buildLookupMaps() {
    let preloadResults = await Promise.all([
      figma.variables.getLocalVariablesAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
      figma.getLocalPaintStylesAsync()
    ]);
    let localVars = preloadResults[0];
    let localTextStyles = preloadResults[1];
    let localEffectStyles = preloadResults[2];
    let localPaintStyles = preloadResults[3];
    let variableMap = {};
    for (let vi = 0; vi < localVars.length; vi++) {
      variableMap[localVars[vi].id] = localVars[vi];
    }
    let textStyleMap = {};
    for (let ti = 0; ti < localTextStyles.length; ti++) {
      textStyleMap[localTextStyles[ti].id] = localTextStyles[ti];
    }
    let effectStyleMap = {};
    for (let ei = 0; ei < localEffectStyles.length; ei++) {
      effectStyleMap[localEffectStyles[ei].id] = localEffectStyles[ei];
    }
    let paintStyleMap = {};
    for (let pi = 0; pi < localPaintStyles.length; pi++) {
      paintStyleMap[localPaintStyles[pi].id] = localPaintStyles[pi];
    }
    let colorVarEntries = [];
    for (let cvi = 0; cvi < localVars.length; cvi++) {
      let cv = localVars[cvi];
      if (cv.resolvedType !== "COLOR") continue;
      let cvModeIds = Object.keys(cv.valuesByMode);
      if (cvModeIds.length === 0) continue;
      let cvVal = cv.valuesByMode[cvModeIds[0]];
      if (!cvVal || typeof cvVal.r !== "number") continue;
      colorVarEntries.push({
        id: cv.id,
        nameLower: cv.name.toLowerCase(),
        color: { r: cvVal.r, g: cvVal.g, b: cvVal.b }
      });
    }
    let floatVarEntries = [];
    for (let flvi = 0; flvi < localVars.length; flvi++) {
      let flv = localVars[flvi];
      if (flv.resolvedType !== "FLOAT") continue;
      let flvModeIds = Object.keys(flv.valuesByMode);
      if (flvModeIds.length === 0) continue;
      let flvVal = flv.valuesByMode[flvModeIds[0]];
      if (typeof flvVal !== "number") continue;
      floatVarEntries.push({
        id: flv.id,
        nameLower: flv.name.toLowerCase(),
        value: flvVal
      });
    }
    let textStyleExactMap = {};
    for (let tsi = 0; tsi < localTextStyles.length; tsi++) {
      let ts = localTextStyles[tsi];
      try {
        if (ts.fontName && typeof ts.fontSize === "number") {
          let tsKey = ts.fontName.family.toLowerCase() + "|" + ts.fontName.style.toLowerCase() + "|" + Math.round(ts.fontSize);
          if (!textStyleExactMap[tsKey]) {
            textStyleExactMap[tsKey] = ts;
          }
        }
      } catch (e) {
      }
    }
    return {
      variableMap,
      textStyleMap,
      effectStyleMap,
      paintStyleMap,
      localVars,
      localTextStyles,
      colorVarEntries,
      floatVarEntries,
      textStyleExactMap
    };
  }

  // src/claude_mcp_plugin/handlers/lint/checks.ts
  function scanNode(node, depth, parent, parentBBox, chk, categories, violations, violationsCappedRef, totalNodesRef) {
    if (node.visible === false) return;
    if (depth > MAX_LINT_DEPTH) return;
    totalNodesRef.value++;
    let nodeType = node.type;
    if (chk.rootFrame && depth === 0 && (nodeType === "FRAME" || nodeType === "COMPONENT")) {
      let DIM_TOL = DIM_TOLERANCE;
      let rfLayoutMode = null;
      try {
        rfLayoutMode = node.layoutMode;
      } catch (e) {
      }
      let rfHasLayout = rfLayoutMode && rfLayoutMode !== "NONE";
      let rfWidth = 0;
      try {
        rfWidth = node.width;
      } catch (e) {
      }
      let rfDevice = null;
      for (let rfdi = 0; rfdi < DEVICE_SIZES.length; rfdi++) {
        if (Math.abs(rfWidth - DEVICE_SIZES[rfdi].width) <= DIM_TOL) {
          rfDevice = DEVICE_SIZES[rfdi];
          break;
        }
      }
      if (rfHasLayout) {
        let rfSizingH = null;
        try {
          rfSizingH = node.layoutSizingHorizontal;
        } catch (e) {
        }
        categories.rootFrame.total++;
        if (rfSizingH === "FIXED") {
          categories.rootFrame.bound++;
        } else {
          categories.rootFrame.unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "CRITICAL",
            "rootFrame",
            "layoutSizingHorizontal",
            "Root frame width must be FIXED (currently: " + (rfSizingH !== null && rfSizingH !== void 0 ? rfSizingH : "unknown") + ")"
          );
        }
      }
      categories.rootFrame.total++;
      if (rfDevice) {
        categories.rootFrame.bound++;
      } else {
        categories.rootFrame.unbound++;
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "HIGH",
          "rootFrame",
          "width",
          "Root frame width (" + rfWidth + "px) does not match a standard device width \u2014 expected: desktop=1440, tablet=768, mobile=375"
        );
      }
      if (rfHasLayout) {
        let rfSizingV = null;
        try {
          rfSizingV = node.layoutSizingVertical;
        } catch (e) {
        }
        categories.rootFrame.total++;
        if (rfSizingV === "HUG") {
          categories.rootFrame.bound++;
        } else {
          categories.rootFrame.unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "HIGH",
            "rootFrame",
            "layoutSizingVertical",
            "Root frame height must be HUG (currently: " + (rfSizingV !== null && rfSizingV !== void 0 ? rfSizingV : "unknown") + ") \u2014 use minHeight for the minimum height constraint"
          );
        }
        let rfMinHeight = null;
        try {
          rfMinHeight = node.minHeight;
        } catch (e) {
        }
        let rfMinHeightNum = rfMinHeight !== null && rfMinHeight !== void 0 ? rfMinHeight : 0;
        let rfExpectedMinH = rfDevice ? rfDevice.minHeight : 0;
        categories.rootFrame.total++;
        if (rfMinHeightNum > 0) {
          categories.rootFrame.bound++;
          if (rfDevice && Math.abs(rfMinHeightNum - rfExpectedMinH) > DIM_TOL) {
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "MEDIUM",
              "rootFrame",
              "minHeight",
              "Root frame minHeight (" + rfMinHeightNum + "px) does not match expected " + rfDevice.name + " height (" + rfExpectedMinH + "px)"
            );
          }
        } else {
          categories.rootFrame.unbound++;
          let rfMinHMsg = "Root frame minHeight not set";
          if (rfDevice) {
            rfMinHMsg += " \u2014 expected " + rfExpectedMinH + "px for " + rfDevice.name;
          } else {
            rfMinHMsg += " \u2014 set to the device viewport height";
          }
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "HIGH",
            "rootFrame",
            "minHeight",
            rfMinHMsg
          );
        }
      }
    }
    if (chk.textStyles && nodeType === "TEXT") {
      categories.typography.total++;
      if (hasTextStyle(node)) {
        categories.typography.bound++;
        try {
          if (node.textStyleId === figma.mixed) {
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "LOW",
              "typography",
              "textStyleId",
              "Text style override present (mixed styles in segments)"
            );
          }
        } catch (e) {
        }
      } else {
        categories.typography.unbound++;
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "HIGH",
          "typography",
          "textStyleId",
          "Text node without textStyleId applied"
        );
      }
      if (hasFontVariableBindings(node)) {
        addViolation(
          violations,
          violationsCappedRef,
          MAX_LINT_VIOLATIONS,
          node,
          depth,
          "CRITICAL",
          "typography",
          "fontVariables",
          "Font variable bound directly to text (should use text style instead)"
        );
      }
    }
    if (chk.colors) {
      let fills = null;
      try {
        fills = node.fills;
      } catch (e) {
      }
      if (fills && fills !== figma.mixed && Array.isArray(fills)) {
        for (let fi = 0; fi < fills.length; fi++) {
          if (!isColorFill(fills[fi])) continue;
          let isIcon = isIconLike(node);
          let catName = isIcon ? "iconColors" : "backgroundFills";
          categories[catName].total++;
          let fillBound = isFillBound(node, "fills", fi) || hasFillPaintStyle(node);
          if (fillBound) {
            categories[catName].bound++;
          } else {
            categories[catName].unbound++;
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "HIGH",
              catName,
              "fills[" + fi + "]",
              "Color using raw hex value (no variable or paint style bound)"
            );
          }
        }
      }
    }
    if (chk.colors) {
      let strokes = null;
      try {
        strokes = node.strokes;
      } catch (e) {
      }
      if (strokes && strokes !== figma.mixed && Array.isArray(strokes) && strokes.length > 0) {
        for (let si = 0; si < strokes.length; si++) {
          if (!isColorFill(strokes[si])) continue;
          categories.strokesBorders.total++;
          let strokeBound = isFillBound(node, "strokes", si) || hasStrokePaintStyle(node);
          if (strokeBound) {
            categories.strokesBorders.bound++;
          } else {
            categories.strokesBorders.unbound++;
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "HIGH",
              "strokesBorders",
              "strokes[" + si + "]",
              "Stroke color using raw hex value (no variable or paint style bound)"
            );
          }
        }
      }
    }
    if (chk.spacing && (nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "COMPONENT_SET" || nodeType === "INSTANCE")) {
      let layoutMode = null;
      try {
        layoutMode = node.layoutMode;
      } catch (e) {
      }
      if (layoutMode && layoutMode !== "NONE") {
        let itemSpacing = 0;
        try {
          itemSpacing = node.itemSpacing;
        } catch (e) {
        }
        if (itemSpacing > 0) {
          categories.spacing.total++;
          if (isScalarBound(node, "itemSpacing")) {
            categories.spacing.bound++;
          } else {
            categories.spacing.unbound++;
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "MEDIUM",
              "spacing",
              "itemSpacing",
              "Item spacing using raw number (" + itemSpacing + ") \u2014 no variable bound"
            );
          }
        }
        let paddingProps = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
        for (let ppi = 0; ppi < paddingProps.length; ppi++) {
          let padVal = 0;
          try {
            padVal = node[paddingProps[ppi]];
          } catch (e) {
          }
          if (padVal > 0) {
            categories.spacing.total++;
            if (isScalarBound(node, paddingProps[ppi])) {
              categories.spacing.bound++;
            } else {
              categories.spacing.unbound++;
              addViolation(
                violations,
                violationsCappedRef,
                MAX_LINT_VIOLATIONS,
                node,
                depth,
                "MEDIUM",
                "spacing",
                paddingProps[ppi],
                paddingProps[ppi] + " using raw number (" + padVal + ") \u2014 no variable bound"
              );
            }
          }
        }
      }
    }
    if (chk.radius && (nodeType === "FRAME" || nodeType === "RECTANGLE" || nodeType === "COMPONENT" || nodeType === "INSTANCE" || nodeType === "ELLIPSE")) {
      let cornerRadius = 0;
      try {
        cornerRadius = node.cornerRadius;
      } catch (e) {
      }
      if (cornerRadius && cornerRadius !== figma.mixed && cornerRadius > 0) {
        categories.borderRadius.total++;
        if (isScalarBound(node, "topLeftRadius") || isScalarBound(node, "topRightRadius") || isScalarBound(node, "bottomLeftRadius") || isScalarBound(node, "bottomRightRadius") || isScalarBound(node, "cornerRadius")) {
          categories.borderRadius.bound++;
        } else {
          categories.borderRadius.unbound++;
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "MEDIUM",
            "borderRadius",
            "cornerRadius",
            "Border radius using raw number (" + cornerRadius + ") \u2014 no variable bound"
          );
        }
      } else if (cornerRadius === figma.mixed) {
        let radiusProps = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];
        for (let ri = 0; ri < radiusProps.length; ri++) {
          let rVal = 0;
          try {
            rVal = node[radiusProps[ri]];
          } catch (e) {
          }
          if (rVal > 0) {
            categories.borderRadius.total++;
            if (isScalarBound(node, radiusProps[ri])) {
              categories.borderRadius.bound++;
            } else {
              categories.borderRadius.unbound++;
              addViolation(
                violations,
                violationsCappedRef,
                MAX_LINT_VIOLATIONS,
                node,
                depth,
                "MEDIUM",
                "borderRadius",
                radiusProps[ri],
                radiusProps[ri] + " using raw number (" + rVal + ") \u2014 no variable bound"
              );
            }
          }
        }
      }
    }
    if (chk.effectStyles) {
      let effects = null;
      try {
        effects = node.effects;
      } catch (e) {
      }
      if (effects && Array.isArray(effects) && effects.length > 0) {
        let hasVisibleEffects = false;
        for (let efi = 0; efi < effects.length; efi++) {
          if (effects[efi].visible !== false) {
            hasVisibleEffects = true;
            break;
          }
        }
        if (hasVisibleEffects) {
          categories.effectStyles.total++;
          if (hasEffectStyle(node)) {
            categories.effectStyles.bound++;
          } else {
            categories.effectStyles.unbound++;
            let effectTypes = [];
            for (let eti = 0; eti < effects.length; eti++) {
              if (effects[eti].visible !== false && effectTypes.indexOf(effects[eti].type) === -1) {
                effectTypes.push(effects[eti].type);
              }
            }
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "CRITICAL",
              "effectStyles",
              "effectStyleId",
              "Raw " + effectTypes.join("/") + " effect (no effect style applied)"
            );
          }
        }
      }
    }
    if (chk.autoLayout && (nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "COMPONENT_SET")) {
      let hasLayout = false;
      try {
        let lm = node.layoutMode;
        hasLayout = lm && lm !== "NONE" ? true : false;
      } catch (e) {
      }
      if (!hasLayout) {
        let childCount = 0;
        try {
          let childrenArr = node.children;
          childCount = childrenArr ? childrenArr.length : 0;
        } catch (e) {
        }
        if (childCount > 0) {
          addViolation(
            violations,
            violationsCappedRef,
            MAX_LINT_VIOLATIONS,
            node,
            depth,
            "MEDIUM",
            "autoLayout",
            "layoutMode",
            "Frame has " + childCount + " children but no auto-layout set"
          );
        }
      } else {
        let alChildren = null;
        try {
          alChildren = node.children;
        } catch (e) {
        }
        if (alChildren && alChildren.length > 0) {
          let absChildCount = 0;
          for (let alci = 0; alci < alChildren.length; alci++) {
            let alChild = alChildren[alci];
            let alChildPos = null;
            try {
              alChildPos = alChild.layoutPositioning;
            } catch (e) {
            }
            if (alChildPos === "ABSOLUTE") {
              absChildCount++;
            }
          }
          if (absChildCount > 0) {
            addViolation(
              violations,
              violationsCappedRef,
              MAX_LINT_VIOLATIONS,
              node,
              depth,
              "LOW",
              "autoLayout",
              "layoutPositioning",
              "Auto-layout frame has " + absChildCount + " absolute-positioned " + (absChildCount === 1 ? "child" : "children") + " \u2014 verify intentional"
            );
          }
        }
      }
    }
    if (chk.overflow && parent !== null && parent !== void 0 && depth > 1) {
      let ovPositioning = null;
      try {
        ovPositioning = node.layoutPositioning;
      } catch (e) {
      }
      let ovName = "";
      try {
        ovName = node.name || "";
      } catch (e) {
      }
      let skipOv = ovPositioning === "ABSOLUTE" || ovName.indexOf("Icon/") === 0 || ovName.indexOf("Image/") === 0;
      if (!skipOv) {
        let childBBox = null;
        try {
          childBBox = node.absoluteBoundingBox;
        } catch (e) {
        }
        if (childBBox && parentBBox) {
          let OV_TOL = 1;
          categories.overflow.total++;
          let hOverflow = childBBox.x + childBBox.width - (parentBBox.x + parentBBox.width);
          let hasHOv = hOverflow > OV_TOL;
          let hasVOv = false;
          let vOverflow = 0;
          let parentSizingV = null;
          try {
            parentSizingV = parent.layoutSizingVertical;
          } catch (e) {
          }
          if (parentSizingV === "FIXED") {
            vOverflow = childBBox.y + childBBox.height - (parentBBox.y + parentBBox.height);
            hasVOv = vOverflow > OV_TOL;
          }
          if (hasHOv || hasVOv) {
            categories.overflow.unbound++;
            if (hasHOv) {
              let hAmt = Math.ceil(hOverflow);
              let hDetails = {
                axis: "horizontal",
                overflowAmount: hAmt,
                childRight: Math.round(childBBox.x + childBBox.width),
                parentRight: Math.round(parentBBox.x + parentBBox.width)
              };
              addViolation(
                violations,
                violationsCappedRef,
                MAX_LINT_VIOLATIONS,
                node,
                depth,
                "CRITICAL",
                "overflow",
                "absoluteBoundingBox",
                "Horizontal overflow: child extends " + hAmt + "px beyond parent right edge",
                hDetails
              );
            }
            if (hasVOv) {
              let vAmt = Math.ceil(vOverflow);
              let vDetails = {
                axis: "vertical",
                overflowAmount: vAmt,
                childBottom: Math.round(childBBox.y + childBBox.height),
                parentBottom: Math.round(parentBBox.y + parentBBox.height)
              };
              addViolation(
                violations,
                violationsCappedRef,
                MAX_LINT_VIOLATIONS,
                node,
                depth,
                "CRITICAL",
                "overflow",
                "absoluteBoundingBox",
                "Vertical overflow: child extends " + vAmt + "px beyond parent bottom edge",
                vDetails
              );
            }
          } else {
            categories.overflow.bound++;
          }
        }
      }
    }
    if ("children" in node && node.children) {
      let nodeBBox = null;
      if (chk.overflow) {
        try {
          nodeBBox = node.absoluteBoundingBox;
        } catch (e) {
        }
      }
      let nodeChildren = node.children;
      for (let ci = 0; ci < nodeChildren.length; ci++) {
        scanNode(nodeChildren[ci], depth + 1, node, nodeBBox, chk, categories, violations, violationsCappedRef, totalNodesRef);
      }
    }
  }

  // src/claude_mcp_plugin/handlers/lint/fix.ts
  function findBestColorVar(rawColor, category, colorVarEntries) {
    let bestEntry = null;
    let bestEffDist = Infinity;
    for (let bfi = 0; bfi < colorVarEntries.length; bfi++) {
      let entry = colorVarEntries[bfi];
      let dist = colorDist(rawColor, entry.color);
      if (dist < COLOR_EXACT_THRESHOLD) return entry;
      if (dist > COLOR_NEAR_THRESHOLD) continue;
      let rawEffDist = dist - (isSemanticMatch(entry.nameLower, category) ? COLOR_SEMANTIC_BONUS : 0);
      let effDist = rawEffDist < 0 ? 0 : rawEffDist;
      if (effDist < bestEffDist) {
        bestEffDist = effDist;
        bestEntry = entry;
      }
    }
    return bestEntry;
  }
  function findBestFloatVar(rawValue, category, floatVarEntries) {
    if (rawValue === 0) {
      for (let zi = 0; zi < floatVarEntries.length; zi++) {
        if (floatVarEntries[zi].value === 0) return floatVarEntries[zi];
      }
      return null;
    }
    let kws = FLOAT_SEMANTIC_KEYWORDS[category];
    let bestSemantic = null;
    let bestSemanticDist = Infinity;
    let bestAny = null;
    let bestAnyDist = Infinity;
    for (let fli = 0; fli < floatVarEntries.length; fli++) {
      let entry = floatVarEntries[fli];
      let dist = Math.abs(rawValue - entry.value);
      let hasSemantic = false;
      if (kws) {
        for (let fki = 0; fki < kws.length; fki++) {
          if (entry.nameLower.indexOf(kws[fki]) !== -1) {
            hasSemantic = true;
            break;
          }
        }
      }
      if (hasSemantic && dist < bestSemanticDist) {
        bestSemanticDist = dist;
        bestSemantic = entry;
      }
      if (dist < bestAnyDist) {
        bestAnyDist = dist;
        bestAny = entry;
      }
    }
    let semanticThreshold = Math.max(rawValue * 0.3, 4);
    if (bestSemantic && bestSemanticDist <= semanticThreshold) return bestSemantic;
    let anyThreshold = Math.max(rawValue * 0.1, 2);
    if (bestAny && bestAnyDist <= anyThreshold) return bestAny;
    return null;
  }
  async function applyFixes(violations, categories, maps) {
    let DEVICE_FIX_SPECS = DEVICE_SIZES;
    let DIM_TOL = DIM_TOLERANCE;
    let lastFixNodeId = null;
    let lastFixNode = null;
    for (let fxi = 0; fxi < violations.length; fxi++) {
      let fv = violations[fxi];
      fv.fixed = false;
      let fvCat = fv.category;
      let isRootFrameViol = fvCat === "rootFrame";
      let isColorViol = fvCat === "backgroundFills" || fvCat === "iconColors" || fvCat === "strokesBorders";
      let isSpacingViol = fvCat === "spacing";
      let isRadiusViol = fvCat === "borderRadius";
      let isTypographyViol = fvCat === "typography";
      if (!isRootFrameViol && !isColorViol && !isSpacingViol && !isRadiusViol && !isTypographyViol) continue;
      let fixNode = null;
      if (fv.nodeId === lastFixNodeId) {
        fixNode = lastFixNode;
      } else {
        try {
          fixNode = await figma.getNodeByIdAsync(fv.nodeId);
        } catch (e) {
        }
        lastFixNodeId = fv.nodeId;
        lastFixNode = fixNode;
      }
      if (!fixNode) continue;
      if (isRootFrameViol) {
        if (fv.property === "layoutSizingHorizontal") {
          try {
            fixNode.layoutSizingHorizontal = "FIXED";
            fv.fixed = true;
            fv.fixedWith = "layoutSizingHorizontal = FIXED";
            categories.rootFrame.unbound = Math.max(0, categories.rootFrame.unbound - 1);
            categories.rootFrame.bound++;
          } catch (e) {
          }
        } else if (fv.property === "layoutSizingVertical") {
          try {
            fixNode.layoutSizingVertical = "HUG";
            fv.fixed = true;
            fv.fixedWith = "layoutSizingVertical = HUG";
            categories.rootFrame.unbound = Math.max(0, categories.rootFrame.unbound - 1);
            categories.rootFrame.bound++;
          } catch (e) {
          }
        } else if (fv.property === "minHeight") {
          try {
            let fwWidth = fixNode.width !== void 0 ? fixNode.width : 0;
            let fwExpected = 0;
            for (let fwdi = 0; fwdi < DEVICE_FIX_SPECS.length; fwdi++) {
              if (Math.abs(fwWidth - DEVICE_FIX_SPECS[fwdi].width) <= DIM_TOL) {
                fwExpected = DEVICE_FIX_SPECS[fwdi].minHeight;
                break;
              }
            }
            if (fwExpected > 0) {
              fixNode.minHeight = fwExpected;
              fv.fixed = true;
              fv.fixedWith = "minHeight = " + fwExpected + "px";
              categories.rootFrame.unbound = Math.max(0, categories.rootFrame.unbound - 1);
              categories.rootFrame.bound++;
            }
          } catch (e) {
          }
        }
      } else if (isColorViol) {
        let propPartsMatch = fv.property.match(/^(fills|strokes)\[(\d+)\]$/);
        if (propPartsMatch) {
          let propName = propPartsMatch[1];
          let propIdx = parseInt(propPartsMatch[2], 10);
          try {
            let paints = fixNode[propName];
            if (paints && Array.isArray(paints) && paints.length > propIdx) {
              let paint = paints[propIdx];
              if (paint && paint.type === "SOLID" && paint.color) {
                let bestEntry = findBestColorVar(paint.color, fvCat, maps.colorVarEntries);
                if (bestEntry) {
                  let varObj = maps.variableMap[bestEntry.id];
                  if (varObj) {
                    let paintsCopy = paints.slice();
                    paintsCopy[propIdx] = figma.variables.setBoundVariableForPaint(paintsCopy[propIdx], "color", varObj);
                    fixNode[propName] = paintsCopy;
                    fv.fixed = true;
                    fv.fixedWith = varObj.name;
                    let colorCats = categories;
                    colorCats[fvCat].unbound = Math.max(0, colorCats[fvCat].unbound - 1);
                    colorCats[fvCat].bound++;
                  }
                }
              }
            }
          } catch (e) {
          }
        }
      } else if (isSpacingViol) {
        let spacingProp = fv.property;
        try {
          let rawSpacing = fixNode[spacingProp];
          if (typeof rawSpacing === "number") {
            let bestSpacingVar = findBestFloatVar(rawSpacing, "spacing", maps.floatVarEntries);
            if (bestSpacingVar) {
              let spacingVarObj = maps.variableMap[bestSpacingVar.id];
              if (spacingVarObj) {
                fixNode.setBoundVariable(spacingProp, spacingVarObj);
                fv.fixed = true;
                fv.fixedWith = spacingVarObj.name;
                categories.spacing.unbound = Math.max(0, categories.spacing.unbound - 1);
                categories.spacing.bound++;
              }
            }
          }
        } catch (e) {
        }
      } else if (isRadiusViol) {
        let radiusProp = fv.property;
        try {
          let rawRadius = fixNode[radiusProp];
          if (typeof rawRadius === "number") {
            let bestRadiusVar = findBestFloatVar(rawRadius, "borderRadius", maps.floatVarEntries);
            if (bestRadiusVar) {
              let radiusVarObj = maps.variableMap[bestRadiusVar.id];
              if (radiusVarObj) {
                fixNode.setBoundVariable(radiusProp, radiusVarObj);
                fv.fixed = true;
                fv.fixedWith = radiusVarObj.name;
                categories.borderRadius.unbound = Math.max(0, categories.borderRadius.unbound - 1);
                categories.borderRadius.bound++;
              }
            }
          }
        } catch (e) {
        }
      } else if (isTypographyViol && fv.property === "textStyleId") {
        try {
          let tnFontName = fixNode.fontName;
          let tnFontSize = fixNode.fontSize;
          if (tnFontName && tnFontName !== figma.mixed && tnFontSize && tnFontSize !== figma.mixed) {
            let fn = tnFontName;
            let fs = tnFontSize;
            let tsKey = fn.family.toLowerCase() + "|" + fn.style.toLowerCase() + "|" + Math.round(fs);
            let matchingStyle = maps.textStyleExactMap[tsKey];
            if (matchingStyle) {
              fixNode.textStyleId = matchingStyle.id;
              fv.fixed = true;
              fv.fixedWith = matchingStyle.name;
              categories.typography.unbound = Math.max(0, categories.typography.unbound - 1);
              categories.typography.bound++;
            } else {
              let bestFontSizeVar = findBestFloatVar(fs, "typography", maps.floatVarEntries);
              if (bestFontSizeVar) {
                let fontSizeVarObj = maps.variableMap[bestFontSizeVar.id];
                if (fontSizeVarObj) {
                  fixNode.setBoundVariable("fontSize", fontSizeVarObj);
                  fv.message = fv.message + " (fontSize bound to " + fontSizeVarObj.name + ")";
                }
              }
            }
          }
        } catch (e) {
        }
      }
    }
  }

  // src/claude_mcp_plugin/handlers/lint/index.ts
  async function lintFrame(params) {
    const lintParams = params;
    let nodeId = lintParams ? lintParams.nodeId : void 0;
    let checks = lintParams ? lintParams.checks : void 0;
    let fix = lintParams ? lintParams.fix === true : false;
    if (!nodeId) throw new Error("nodeId is required");
    let rootNode = await figma.getNodeByIdAsync(nodeId);
    if (!rootNode) throw new Error("Node not found: " + String(nodeId).substring(0, 50));
    let isPageChild = rootNode.parent !== null && rootNode.parent !== void 0 && rootNode.parent.type === "PAGE";
    let chk = {
      rootFrame: isPageChild,
      colors: true,
      spacing: true,
      radius: true,
      textStyles: true,
      effectStyles: true,
      autoLayout: true,
      overflow: true
    };
    if (checks) {
      if (checks.rootFrame === false) chk.rootFrame = false;
      if (checks.rootFrame === true) chk.rootFrame = true;
      if (checks.colors === false) chk.colors = false;
      if (checks.spacing === false) chk.spacing = false;
      if (checks.radius === false) chk.radius = false;
      if (checks.textStyles === false) chk.textStyles = false;
      if (checks.effectStyles === false) chk.effectStyles = false;
      if (checks.autoLayout === false) chk.autoLayout = false;
      if (checks.overflow === false) chk.overflow = false;
    }
    let maps = await buildLookupMaps();
    let categories = {
      rootFrame: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      typography: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      spacing: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      borderRadius: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      iconColors: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      strokesBorders: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      backgroundFills: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      effectStyles: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      overflow: { total: 0, bound: 0, unbound: 0, compliance: 100 }
    };
    let violations = [];
    let violationsCappedRef = { value: false };
    let totalNodesRef = { value: 0 };
    scanNode(rootNode, 0, null, null, chk, categories, violations, violationsCappedRef, totalNodesRef);
    if (fix) {
      await applyFixes(violations, categories, maps);
    }
    let catKeys = ["rootFrame", "typography", "spacing", "borderRadius", "iconColors", "strokesBorders", "backgroundFills", "effectStyles", "overflow"];
    for (let ck = 0; ck < catKeys.length; ck++) {
      let cat = categories[catKeys[ck]];
      if (cat.total > 0) {
        cat.compliance = Math.round(cat.bound / cat.total * 100);
      } else {
        cat.compliance = 100;
      }
    }
    let summaryCritical = 0;
    let summaryHigh = 0;
    let summaryMedium = 0;
    let summaryLow = 0;
    let summaryFixed = 0;
    for (let sv = 0; sv < violations.length; sv++) {
      if (violations[sv].fixed === true) {
        summaryFixed++;
        continue;
      }
      switch (violations[sv].severity) {
        case "CRITICAL":
          summaryCritical++;
          break;
        case "HIGH":
          summaryHigh++;
          break;
        case "MEDIUM":
          summaryMedium++;
          break;
        case "LOW":
          summaryLow++;
          break;
      }
    }
    let summaryTotal = violations.length - summaryFixed;
    let overallTotal = 0;
    let overallBound = 0;
    for (let ok = 0; ok < catKeys.length; ok++) {
      overallTotal += categories[catKeys[ok]].total;
      overallBound += categories[catKeys[ok]].bound;
    }
    let overallCompliance = overallTotal > 0 ? Math.round(overallBound / overallTotal * 100) : 100;
    return {
      nodeId: rootNode.id,
      nodeName: rootNode.name,
      nodeType: rootNode.type,
      totalNodes: totalNodesRef.value,
      categories,
      violations,
      violationsCapped: violationsCappedRef.value,
      summary: {
        total: summaryTotal,
        critical: summaryCritical,
        high: summaryHigh,
        medium: summaryMedium,
        low: summaryLow,
        compliance: overallCompliance,
        fixed: summaryFixed
      }
    };
  }

  // src/claude_mcp_plugin/handlers/batch.ts
  var RESOLVE_MAX_PATH_DEPTH = 10;
  function resolveResultReferences(params, results) {
    if (params === null || params === void 0) return params;
    if (typeof params === "string") {
      const refMatch = params.match(/^\$result\[(\d+)\](.*)$/);
      if (refMatch) {
        const refIndex = parseInt(refMatch[1], 10);
        const fieldPath = refMatch[2];
        if (refIndex >= results.length) {
          throw new Error(
            "$result[" + refIndex + "] references action that has not executed yet (only " + results.length + " completed)"
          );
        }
        const referencedResult = results[refIndex];
        if (!referencedResult.success) {
          throw new Error(
            "$result[" + refIndex + "] references a failed action: " + (referencedResult.error !== void 0 ? referencedResult.error : "unknown error")
          );
        }
        let value = referencedResult.result;
        if (fieldPath) {
          const segments = fieldPath.match(/\.([a-zA-Z_]\w*)|(\[\d+\])/g);
          if (segments) {
            if (segments.length > RESOLVE_MAX_PATH_DEPTH) {
              throw new Error(
                "Field path exceeds maximum depth of " + RESOLVE_MAX_PATH_DEPTH + ": $result[" + refIndex + "]" + fieldPath
              );
            }
            for (let s = 0; s < segments.length; s++) {
              const segment = segments[s];
              if (value === null || value === void 0) {
                throw new Error(
                  "Cannot access '" + segment + "' on null/undefined in $result[" + refIndex + "]" + fieldPath
                );
              }
              if (segment.startsWith("[")) {
                const arrIndex = parseInt(segment.slice(1, -1), 10);
                value = value[arrIndex];
              } else {
                value = value[segment.slice(1)];
              }
            }
          }
        }
        return value;
      }
      return params;
    }
    if (Array.isArray(params)) {
      return params.map(function(item) {
        return resolveResultReferences(item, results);
      });
    }
    if (typeof params === "object") {
      const resolved = {};
      const keys = Object.keys(params);
      for (let k = 0; k < keys.length; k++) {
        resolved[keys[k]] = resolveResultReferences(
          params[keys[k]],
          results
        );
      }
      return resolved;
    }
    return params;
  }
  async function batchActions(params, handleCommand2) {
    const rawActions = params !== null && params !== void 0 ? params["actions"] : void 0;
    const stopOnError = params !== null && params !== void 0 && params["stopOnError"] !== void 0 ? params["stopOnError"] : false;
    if (!Array.isArray(rawActions) || rawActions.length === 0) {
      throw new Error("batch_actions requires a non-empty 'actions' array");
    }
    const actions = rawActions;
    const results = [];
    let succeeded = 0;
    let failed = 0;
    const commandId = params !== null && params !== void 0 && params["commandId"] !== void 0 ? String(params["commandId"]) : "batch";
    const totalActions = actions.length;
    const shouldSendProgress = totalActions > 10;
    for (let i = 0; i < totalActions; i++) {
      const { action, params: actionParams } = actions[i];
      if (action === "batch_actions") {
        results.push({
          index: i,
          action,
          success: false,
          error: "Recursive batch_actions calls are not allowed"
        });
        failed++;
        if (stopOnError) break;
        continue;
      }
      try {
        const resolvedParams = resolveResultReferences(
          actionParams !== null && actionParams !== void 0 ? actionParams : {},
          results
        );
        const result = await handleCommand2(action, resolvedParams);
        results.push({ index: i, action, success: true, result });
        succeeded++;
      } catch (error) {
        results.push({
          index: i,
          action,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
        failed++;
        if (shouldSendProgress) {
          const progress = Math.round((i + 1) / totalActions * 100);
          sendProgressUpdate(
            commandId,
            "batch_actions",
            "in_progress",
            progress,
            totalActions,
            i + 1,
            `Action ${i + 1} (${action}) failed. Processed ${i + 1}/${totalActions} (${succeeded} succeeded, ${failed} failed)`
          );
        }
        if (stopOnError) break;
      }
      if (shouldSendProgress && (i + 1) % 10 === 0) {
        const progress = Math.round((i + 1) / totalActions * 100);
        sendProgressUpdate(
          commandId,
          "batch_actions",
          "in_progress",
          progress,
          totalActions,
          i + 1,
          `Processed ${i + 1}/${totalActions} actions (${succeeded} succeeded, ${failed} failed)`
        );
      }
    }
    return {
      success: failed === 0,
      totalActions,
      succeeded,
      failed,
      results
    };
  }

  // src/claude_mcp_plugin/index.ts
  var state = {
    serverPort: 3055
  };
  figma.showUI(__html__, { width: 220, height: 200 });
  figma.ui.postMessage({ type: "file-name", fileName: figma.root.name });
  figma.on("run", function() {
    figma.ui.postMessage({ type: "auto-connect" });
  });
  function updateSettings(settings) {
    if (settings["serverPort"]) {
      state.serverPort = settings["serverPort"];
    }
    figma.clientStorage.setAsync("settings", {
      serverPort: state.serverPort
    });
  }
  (async function initializePlugin() {
    try {
      const savedSettings = await figma.clientStorage.getAsync("settings");
      if (savedSettings) {
        if (savedSettings["serverPort"]) {
          state.serverPort = savedSettings["serverPort"];
        }
      }
      figma.ui.postMessage({
        type: "init-settings",
        settings: {
          serverPort: state.serverPort
        }
      });
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  })();
  async function handleCommand(command, params) {
    debugLog(`handleCommand: ${command}`);
    switch (command) {
      // Document
      case "get_document_info":
        return await getDocumentInfo();
      case "get_file_key":
        return await getFileKey();
      case "get_selection":
        return await getSelection();
      case "get_node_info":
        if (!params || !params["nodeId"]) {
          throw new Error("Missing nodeId parameter");
        }
        return await getNodeInfo(params["nodeId"], {
          stripImages: params["stripImages"] !== false
        });
      case "get_nodes_info":
        if (!params || !params["nodeIds"] || !Array.isArray(params["nodeIds"])) {
          throw new Error("Missing or invalid nodeIds parameter");
        }
        return await getNodesInfo(params["nodeIds"], {
          stripImages: params["stripImages"] !== false
        });
      // Node creation
      case "create_rectangle":
        return await createRectangle(params);
      case "create_frame":
        return await createFrame(params);
      case "create_text":
        return await createText(params);
      // Fills & strokes
      case "set_fill_color":
        return await setFillColor(params);
      case "set_stroke_color":
        return await setStrokeColor(params);
      case "set_image_fill":
        return await setImageFill(params);
      case "set_gradient_fill":
        return await setGradientFill(params);
      // Node operations
      case "move_node":
        return await moveNode(params);
      case "resize_node":
        return await resizeNode(params);
      case "delete_node":
        return await deleteNode(params);
      case "delete_multiple_nodes":
        return await deleteMultipleNodes(params);
      case "clone_node":
        return await cloneNode(params);
      case "rename_node":
        return await renameNode(params);
      case "insert_child":
        return await insertChild(params);
      case "group_nodes":
        return await groupNodes(params);
      case "ungroup_nodes":
        return await ungroupNodes(params);
      case "flatten_node":
        return await flattenNode(params);
      case "export_node_as_image":
        return await exportNodeAsImage(params);
      case "set_corner_radius":
        return await setCornerRadius(params);
      // Styles & components
      case "get_styles":
        return await getStyles();
      case "get_local_components":
        return await getLocalComponents();
      case "get_remote_components":
        return await getRemoteComponents();
      case "create_component_instance":
        return await createComponentInstance(params);
      case "detach_instance":
        return await detachInstance(params);
      case "create_component":
        return await createComponent(params);
      case "create_component_set":
        return await createComponentSet(params);
      case "add_component_property":
        return await addComponentProperty(params);
      case "edit_component_property":
        return await editComponentProperty(params);
      case "delete_component_property":
        return await deleteComponentProperty(params);
      case "set_component_property_references":
        return await setComponentPropertyReferences(params);
      case "get_component_properties":
        return await getComponentProperties(params);
      // Text
      case "set_text_content":
        return await setTextContent(params);
      case "scan_text_nodes":
        return await scanTextNodes(params);
      case "set_multiple_text_contents":
        return await setMultipleTextContents(params);
      case "set_auto_layout":
        return await setAutoLayout(params);
      case "set_font_name":
        return await setFontName(params);
      case "set_font_size":
        return await setFontSize(params);
      case "set_font_weight":
        return await setFontWeight(params);
      case "set_letter_spacing":
        return await setLetterSpacing(params);
      case "set_line_height":
        return await setLineHeight(params);
      case "set_paragraph_spacing":
        return await setParagraphSpacing(params);
      case "set_text_case":
        return await setTextCase(params);
      case "set_text_decoration":
        return await setTextDecoration(params);
      case "get_styled_text_segments":
        return await getStyledTextSegments(params);
      case "load_font_async":
        return await loadFontAsyncWrapper(params);
      case "create_text_style":
        return await createTextStyle(params);
      case "create_text_style_from_properties":
        return await createTextStyleFromProperties(params);
      case "apply_text_style":
        return await applyTextStyle(params);
      case "get_text_styles":
        return await getTextStyles();
      case "delete_text_style":
        return await deleteTextStyle(params);
      case "update_text_style":
        return await updateTextStyle(params);
      // Effects
      case "set_effects":
        return await setEffects(params);
      case "set_effect_style_id":
        return await setEffectStyleId(params);
      case "create_effect_style":
        return await createEffectStyle(params);
      case "update_effect_style":
        return await updateEffectStyle(params);
      case "delete_effect_style":
        return await deleteEffectStyle(params);
      // Shapes
      case "create_ellipse":
        return await createEllipse(params);
      case "create_polygon":
        return await createPolygon(params);
      case "create_star":
        return await createStar(params);
      case "create_svg":
        return await createSvg(params);
      case "update_icon":
        return await updateIcon(params);
      case "create_vector":
        return await createVector(params);
      case "create_line":
        return await createLine(params);
      // Variables
      case "get_variables":
        return await getVariables();
      case "get_bound_variables":
        return await getBoundVariables(params);
      case "bind_variable":
        return await bindVariable(params);
      case "unbind_variable":
        return await unbindVariable(params);
      case "get_variable_collections":
        return await getVariableCollections();
      case "create_variable_collection":
        return await createVariableCollection(params);
      case "get_collection_info":
        return await getCollectionInfo(params);
      case "rename_variable_collection":
        return await renameVariableCollection(params);
      case "delete_variable_collection":
        return await deleteVariableCollection(params);
      case "create_variable":
        return await createVariable(params);
      case "create_variables_batch":
        return await createVariablesBatch(params);
      case "update_variable_value":
        return await updateVariableValue(params);
      case "rename_variable":
        return await renameVariable(params);
      case "delete_variable":
        return await deleteVariable(params);
      case "delete_variables_batch":
        return await deleteVariablesBatch(params);
      case "audit_collection":
        return await auditCollection(params);
      case "validate_color_contrast":
        return await validateColorContrast(params);
      case "suggest_missing_variables":
        return await suggestMissingVariables(params);
      case "apply_default_theme":
        return await applyDefaultTheme(params);
      case "create_color_scale_set":
        return await createColorScaleSet(params);
      case "apply_custom_palette":
        return await applyCustomPalette(params);
      case "reorder_variables":
        return await reorderVariables(params);
      case "generate_audit_report":
        return await generateAuditReport(params);
      case "export_collection_schema":
        return await exportCollectionSchema(params);
      case "import_collection_schema":
        return await importCollectionSchema(params);
      case "create_all_scales":
        return await createAllScales(params);
      case "fix_collection_to_standard":
        return await fixCollectionToStandard(params);
      case "add_chart_colors":
        return await addChartColors(params);
      case "add_mode_to_collection":
        return await addModeToCollection(params);
      case "rename_mode":
        return await renameMode(params);
      case "delete_mode":
        return await deleteMode(params);
      case "duplicate_mode_values":
        return await duplicateModeValues(params);
      // Layout
      case "create_spacing_system":
        return await createSpacingSystem(params);
      case "create_typography_system":
        return await createTypographySystem(params);
      case "create_radius_system":
        return await createRadiusSystem(params);
      case "set_layout_mode":
        return await setLayoutMode(params);
      case "set_padding":
        return await setPadding(params);
      case "set_item_spacing":
        return await setItemSpacing(params);
      case "set_axis_align":
        return await setAxisAlign(params);
      case "set_layout_sizing":
        return await setLayoutSizing(params);
      // Selection & focus
      case "set_focus":
        return await setFocus(params);
      case "set_selections":
        return await setSelections(params);
      case "read_my_design":
        return await readMyDesign(params);
      case "scan_nodes_by_types":
        return await scanNodesByTypes(params);
      // Annotations
      case "get_annotations":
        return await getAnnotations(params);
      case "set_annotation":
        return await setAnnotation(params);
      case "set_multiple_annotations":
        return await setMultipleAnnotations(params);
      case "get_annotation_categories":
        return await getAnnotationCategories();
      case "create_annotation_category":
        return await createAnnotationCategory(params);
      case "update_annotation_category":
        return await updateAnnotationCategory(params);
      case "delete_annotation_category":
        return await deleteAnnotationCategory(params);
      // Prototyping
      case "get_reactions":
        return await getReactions(params);
      case "set_default_connector":
        return await setDefaultConnector(params);
      case "create_connections":
        return await createConnections(params);
      // Pages
      case "create_page":
        return await createPage(params);
      case "rename_page":
        return await renamePage(params);
      case "delete_page":
        return await deletePage(params);
      // Design system
      case "create_from_data":
        return await createFromData(params);
      case "get_design_system":
        return await getDesignSystem();
      case "setup_design_system":
        return await setupDesignSystem(params);
      // Batch
      case "batch_actions":
        return await batchActions(params, handleCommand);
      // Lint
      case "lint_frame":
        return await lintFrame(params);
      // Not yet implemented — handlers exist in MCP server but have no plugin-side logic
      case "get_instance_overrides":
        throw new Error("get_instance_overrides is not yet implemented in the Figma plugin");
      case "set_instance_overrides":
        throw new Error("set_instance_overrides is not yet implemented in the Figma plugin");
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }
  figma.ui.onmessage = async (msg) => {
    switch (msg["type"]) {
      case "update-settings":
        updateSettings(msg);
        break;
      case "notify":
        figma.notify(msg["message"]);
        break;
      case "close-plugin":
        figma.closePlugin();
        break;
      case "get-file-name":
        figma.ui.postMessage({ type: "file-name", fileName: figma.root.name });
        break;
      case "execute-command":
        try {
          const result = await handleCommand(
            msg["command"],
            msg["params"] || {}
          );
          figma.ui.postMessage({
            type: "command-result",
            id: msg["id"],
            command: msg["command"],
            result
          });
        } catch (error) {
          figma.ui.postMessage({
            type: "command-error",
            id: msg["id"],
            command: msg["command"],
            error: error instanceof Error ? error.message : "Error executing command"
          });
        }
        break;
      default:
        break;
    }
  };
})();
