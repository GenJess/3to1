
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI } from '@google/genai';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

import { TreeNode, GraphState } from './types';
import { generateId } from './utils';

import { 
    ThinkingIcon, 
    CodeIcon, 
    SparklesIcon, 
    ArrowUpIcon, 
    GridIcon
} from './components/Icons';

const ZOOM_SPEED = 0.001;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
// Adjusted gaps for Vertical Layout
const LEVEL_GAP = 500; // Vertical distance between generations
const SIBLING_GAP = 360; // Horizontal distance between variants
const NODE_WIDTH = 320;
const NODE_HEIGHT = 240;

function App() {
    const [graph, setGraph] = useState<GraphState>({
        nodes: {},
        rootIds: [],
        selectedNodeIds: [],
        activeNodeId: null,
        nextLabelIndex: 1
    });
    
    const [view, setView] = useState({ x: window.innerWidth / 2 - NODE_WIDTH / 2, y: 100, zoom: 0.8 });
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [soloMode, setSoloMode] = useState(false);
    const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
    const [showCode, setShowCode] = useState(false);
    const [hoveredEdge, setHoveredEdge] = useState<{ id: string, x: number, y: number, prompt: string } | null>(null);
    
    const canvasRef = useRef<HTMLDivElement>(null);
    const isPanning = useRef(false);
    const lastPos = useRef({ x: 0, y: 0 });
    const recognitionRef = useRef<any>(null);

    // Vertical Tree Layout Algorithm
    const applyLayout = useCallback((nodes: Record<string, TreeNode>, rootIds: string[]) => {
        const childrenMap: Record<string, string[]> = {};
        Object.values(nodes).forEach(n => {
            if (n.parentId) {
                if (!childrenMap[n.parentId]) childrenMap[n.parentId] = [];
                childrenMap[n.parentId].push(n.id);
            }
        });

        const subtreeWidths: Record<string, number> = {};
        
        // Post-order traversal to calculate widths
        const calculateSubtreeWidth = (id: string): number => {
            const children = childrenMap[id] || [];
            if (children.length === 0) {
                subtreeWidths[id] = SIBLING_GAP;
                return SIBLING_GAP;
            }
            const totalWidth = children.reduce((acc, cid) => acc + calculateSubtreeWidth(cid), 0);
            subtreeWidths[id] = Math.max(SIBLING_GAP, totalWidth);
            return subtreeWidths[id];
        };

        rootIds.forEach(calculateSubtreeWidth);

        const newNodes = { ...nodes };
        
        // Pre-order traversal to set positions
        const positionNode = (id: string, y: number, minX: number) => {
            const node = newNodes[id];
            const width = subtreeWidths[id];
            
            // Center the node horizontally within its allocated subtree width
            node.position = {
                x: minX + (width / 2) - (NODE_WIDTH / 2),
                y: y
            };

            let currentX = minX;
            const children = childrenMap[id] || [];
            children.forEach(cid => {
                positionNode(cid, y + LEVEL_GAP, currentX);
                currentX += subtreeWidths[cid];
            });
        };

        let rootX = 0;
        rootIds.forEach(rid => {
            positionNode(rid, 100, rootX);
            rootX += subtreeWidths[rid];
        });

        return newNodes;
    }, []);

    // Fit to Screen (Overview Mode)
    const fitView = () => {
        const nodeVals: TreeNode[] = Object.values(graph.nodes);
        if (nodeVals.length === 0) return;
        
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodeVals.forEach(n => {
            minX = Math.min(minX, n.position.x);
            maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
            minY = Math.min(minY, n.position.y);
            maxY = Math.max(maxY, n.position.y + NODE_HEIGHT);
        });

        const padding = 100;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;
        
        const scale = Math.min(
            (window.innerWidth - 100) / width, 
            (window.innerHeight - 100) / height,
            0.9
        );

        setView({
            x: (window.innerWidth - width * scale) / 2 - minX * scale + padding * scale,
            y: (window.innerHeight - height * scale) / 2 - minY * scale + padding * scale,
            zoom: scale
        });
    };

    // Stable Voice Transcription
    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        setInputValue(prev => (prev.trim() + ' ' + event.results[i][0].transcript).trim());
                    }
                }
            };
            recognition.onerror = () => setIsListening(false);
            recognitionRef.current = recognition;
        }
    }, []);

    const toggleVoice = () => {
        if (!recognitionRef.current) return;
        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    const handleNodeClick = (id: string, e: React.MouseEvent) => {
        setGraph(prev => {
            const isSelected = prev.selectedNodeIds.includes(id);
            let nextSelected = [...prev.selectedNodeIds];

            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                if (isSelected) {
                    nextSelected = nextSelected.filter(sid => sid !== id);
                } else {
                    nextSelected.push(id);
                }
            } else {
                nextSelected = [id];
            }

            return {
                ...prev,
                selectedNodeIds: nextSelected,
                activeNodeId: id
            };
        });
    };

    const handleNodeDoubleClick = (id: string) => {
        setExpandedNodeId(id);
    };

    const clearSelection = () => {
        setGraph(prev => ({ ...prev, selectedNodeIds: [], activeNodeId: null }));
    };

    // Pan & Zoom
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const delta = -e.deltaY * ZOOM_SPEED;
                setView(v => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom + delta)) }));
            } else {
                setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
            }
        };

        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 0 && (e.target as HTMLElement).classList.contains('canvas-container')) {
                isPanning.current = true;
                lastPos.current = { x: e.clientX, y: e.clientY };
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (isPanning.current) {
                const dx = e.clientX - lastPos.current.x;
                const dy = e.clientY - lastPos.current.y;
                setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
                lastPos.current = { x: e.clientX, y: e.clientY };
            }
        };

        const onMouseUp = () => isPanning.current = false;

        el.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        return () => {
            el.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    const handleBranch = async (overridePrompt?: string) => {
        const currentPrompt = overridePrompt || inputValue;
        if (!currentPrompt.trim() || isLoading) return;
        setInputValue('');
        setIsLoading(true);

        const parents = graph.selectedNodeIds.map(id => graph.nodes[id]);
        const primaryParentId = graph.activeNodeId || (parents.length > 0 ? parents[0].id : null);
        const primaryParent = primaryParentId ? graph.nodes[primaryParentId] : null;
        
        const variantsCount = soloMode ? 1 : 3;
        const newNodesLocal: Record<string, TreeNode> = { ...graph.nodes };
        const newIds: string[] = [];
        let labelCounter = graph.nextLabelIndex;

        for (let i = 0; i < variantsCount; i++) {
            const id = generateId();
            newIds.push(id);
            newNodesLocal[id] = {
                id,
                parentId: primaryParent?.id || null,
                prompt: currentPrompt,
                styleName: 'Thinking...',
                html: '',
                status: 'streaming',
                depth: (primaryParent?.depth || 0) + 1,
                position: { x: 0, y: 0 },
                childrenIds: [],
                indexLabel: `V${labelCounter++}`
            };
        }

        const nextRootIds = primaryParent ? graph.rootIds : [...graph.rootIds, ...newIds];
        const initialLayout = applyLayout(newNodesLocal, nextRootIds);

        // Center view on the new variants
        // Calculate center X of the new group
        let minNewX = Infinity;
        let maxNewX = -Infinity;
        let avgY = 0;
        newIds.forEach(id => {
            const n = initialLayout[id];
            if (n) {
                minNewX = Math.min(minNewX, n.position.x);
                maxNewX = Math.max(maxNewX, n.position.x + NODE_WIDTH);
                avgY = n.position.y;
            }
        });
        const centerX = (minNewX + maxNewX) / 2;
        const centerY = avgY + NODE_HEIGHT / 2;

        setView(prev => ({
            ...prev,
            x: window.innerWidth / 2 - centerX * prev.zoom,
            y: window.innerHeight / 2 - centerY * prev.zoom
        }));

        setGraph(prev => ({
            ...prev,
            nodes: initialLayout,
            rootIds: nextRootIds,
            selectedNodeIds: [newIds[variantsCount === 1 ? 0 : 1]],
            activeNodeId: newIds[variantsCount === 1 ? 0 : 1],
            nextLabelIndex: labelCounter
        }));

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

            let baseContext = '';
            if (parents.length > 0) {
                baseContext = parents.map((p) => `### REFERENCE ${p.indexLabel}:\nStyle: ${p.styleName}\nCode: ${p.html}`).join('\n\n');
            }

            const stylePrompt = `Create a JSON array of ${variantsCount} high-end, radically distinct design metaphors for: "${currentPrompt}". Output only: ["Name 1", "Name 2", "Name 3"]`;
            const styleRes = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { role: 'user', parts: [{ text: stylePrompt }] }
            });
            const styles = JSON.parse(styleRes.text?.match(/\[.*\]/)?.[0] || '["Alpine Glass", "Industrial Brutalist", "Lumina Flow"]');

            const creativeDirectives = [
                "REIMAGINE. Completely break the existing layout structure.",
                "REFINE. Polish the typography and spacing to perfection.",
                "EXPERIMENTAL. Use bold colors and unique navigation."
            ];

            await Promise.all(newIds.map(async (id, idx) => {
                const styleName = styles[idx];
                const directive = creativeDirectives[idx % creativeDirectives.length];
                
                const finalPrompt = `You are a visionary UI Architect.
                GOAL: "${currentPrompt}"
                THEME: "${styleName}"
                DIRECTIVE: ${directive}

                ${baseContext ? `\n### EVOLVE FROM REFERENCES:\n${baseContext}\n` : `\nSTART FRESH.\n`}

                RULES:
                1. Output ONLY valid raw HTML/CSS.
                2. User may refer to variants by label (e.g. 'V1').
                3. Use modern CSS (Grid, Flexbox).`;

                const stream = await ai.models.generateContentStream({
                    model: 'gemini-3-pro-preview',
                    contents: [{ parts: [{ text: finalPrompt }], role: 'user' }]
                });

                let fullHtml = '';
                for await (const chunk of stream) {
                    fullHtml += chunk.text || '';
                    setGraph(prev => ({
                        ...prev,
                        nodes: { ...prev.nodes, [id]: { ...prev.nodes[id], html: fullHtml } }
                    }));
                }

                setGraph(prev => ({ ...prev, nodes: { ...prev.nodes, [id]: { ...prev.nodes[id], html: fullHtml, styleName, status: 'complete' } } }));
            }));

        } catch (e) {
            console.error("Evolution sequence interrupted", e);
        } finally {
            setIsLoading(false);
        }
    };

    const activeNode = graph.activeNodeId ? graph.nodes[graph.activeNodeId] : null;
    const expandedNode = expandedNodeId ? graph.nodes[expandedNodeId] : null;
    const selectedLabels = graph.selectedNodeIds.map(id => graph.nodes[id]?.indexLabel).filter(Boolean).join(', ');

    return (
        <div className="canvas-container" ref={canvasRef}>
            <div className="canvas-transform" style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
            }}>
                {graph.selectedNodeIds.map(sid => {
                    const node = graph.nodes[sid];
                    if (!node) return null;
                    return (
                        <div 
                            key={`bg-${sid}`}
                            className="synthesis-backdrop" 
                            style={{ left: node.position.x + NODE_WIDTH/2, top: node.position.y + NODE_HEIGHT/2 }} 
                        />
                    );
                })}

                <svg className="edge-layer">
                    <defs>
                        <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                    </defs>
                    {(Object.values(graph.nodes) as TreeNode[]).map(node => {
                        if (!node.parentId) return null;
                        const parent = graph.nodes[node.parentId];
                        if (!parent) return null;
                        
                        // Vertical connections: Bottom of parent to Top of child
                        const startX = parent.position.x + NODE_WIDTH / 2;
                        const startY = parent.position.y + NODE_HEIGHT;
                        const endX = node.position.x + NODE_WIDTH / 2;
                        const endY = node.position.y;
                        
                        const isPrimary = graph.activeNodeId === node.id || graph.selectedNodeIds.includes(node.id);
                        
                        // Vertical Bezier Curve
                        const cp1y = startY + (LEVEL_GAP * 0.5);
                        const cp2y = endY - (LEVEL_GAP * 0.5);

                        return (
                            <path 
                                key={`edge-${node.id}`}
                                className={`edge-path ${isPrimary ? 'active' : ''}`}
                                d={`M ${startX} ${startY} C ${startX} ${cp1y}, ${endX} ${cp2y}, ${endX} ${endY}`}
                                fill="none"
                                stroke={isPrimary ? "var(--accent-glow)" : "rgba(255,255,255,0.15)"}
                                strokeWidth={isPrimary ? "4" : "2"}
                                strokeOpacity={isPrimary ? "1" : "0.5"}
                                filter={isPrimary ? "url(#neon-glow)" : ""}
                                onMouseEnter={(e) => setHoveredEdge({ 
                                    id: node.id, 
                                    x: e.clientX, 
                                    y: e.clientY, 
                                    prompt: node.prompt 
                                })}
                                onMouseLeave={() => setHoveredEdge(null)}
                            />
                        );
                    })}
                </svg>

                {(Object.values(graph.nodes) as TreeNode[]).map(node => {
                    const activeFocus = graph.activeNodeId === node.id;
                    const selected = graph.selectedNodeIds.includes(node.id);
                    const streaming = node.status === 'streaming';
                    
                    let depthClass = 'depth-near';
                    if (activeNode) {
                        const d = Math.abs(node.depth - activeNode.depth);
                        if (d === 1) depthClass = 'depth-mid';
                        else if (d > 1) depthClass = 'depth-far';
                    }

                    return (
                        <div 
                            key={node.id}
                            className={`node-card ${depthClass} ${selected ? 'selected' : ''} ${activeFocus ? 'active-focus' : ''} ${streaming ? 'is-streaming' : ''}`}
                            style={{ left: node.position.x, top: node.position.y }}
                            onClick={(e) => handleNodeClick(node.id, e)}
                            onDoubleClick={() => handleNodeDoubleClick(node.id)}
                        >
                            <div className="variant-label">{node.indexLabel}</div>
                            <div className="node-preview">
                                {streaming && (
                                    <div className="generating-label">
                                        <ThinkingIcon /> 
                                        <span>Drafting...</span>
                                    </div>
                                )}
                                <iframe srcDoc={node.html} title={node.id} sandbox="allow-scripts allow-same-origin" />
                            </div>
                            <div className="node-info">
                                <span className="node-style">{node.styleName}</span>
                                <div className="node-prompt">{node.prompt}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Edge Prompt Tooltip */}
            {hoveredEdge && (
                <div className="edge-tooltip" style={{ left: hoveredEdge.x + 15, top: hoveredEdge.y + 15 }}>
                    <span className="tooltip-label">Prompt used:</span>
                    <span className="tooltip-text">"{hoveredEdge.prompt}"</span>
                </div>
            )}

            <div className="ui-overlay">
                <div className="bottom-input">
                    <div className="input-container">
                        <div className="context-bar">
                            <div className={`mode-toggle ${soloMode ? 'solo' : 'multi'}`} onClick={() => setSoloMode(!soloMode)}>
                                {soloMode ? 'Solo Focus' : 'Triple Gen'}
                            </div>
                            {graph.selectedNodeIds.length > 0 && (
                                <>
                                    <div className="context-pill">
                                        <SparklesIcon /> {selectedLabels} ANCHORED
                                    </div>
                                    <button className="clear-selection" onClick={clearSelection}>Clear Context</button>
                                </>
                            )}
                        </div>
                        <div className="input-row">
                            <button 
                                className={`control-btn ${isListening ? 'active-voice' : ''}`} 
                                onClick={toggleVoice}
                                title="Speech to Input"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                                </svg>
                            </button>
                            <input 
                                placeholder={isListening ? "Listening..." : (graph.selectedNodeIds.length > 0 ? `Evolve ${selectedLabels}...` : "Start a design flow...")}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleBranch()}
                            />
                            <button 
                                className="branch-btn" 
                                onClick={() => handleBranch()}
                                disabled={isLoading || !inputValue.trim()}
                            >
                                {isLoading ? <ThinkingIcon /> : <ArrowUpIcon />}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="canvas-controls">
                    <button className="control-btn" title="Overview / Fit to Screen" onClick={fitView}>
                         <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
                    </button>
                    <button className="control-btn" onClick={() => setView(v => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.25) }))}>+</button>
                    <button className="control-btn" onClick={() => setView(v => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom / 1.25) }))}>-</button>
                    <button className="control-btn" onClick={() => setShowCode(!showCode)}><CodeIcon /></button>
                </div>
            </div>

            {showCode && activeNode && (
                <div className="fullscreen-overlay" onClick={() => setShowCode(false)}>
                    <div className="fullscreen-modal code-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{activeNode.indexLabel} Source Code</h2>
                            <button className="modal-close-btn" onClick={() => setShowCode(false)}>&times;</button>
                        </div>
                        <div className="modal-body code-body">
                            <pre><code>{activeNode.html}</code></pre>
                        </div>
                    </div>
                </div>
            )}

            {expandedNode && (
                <div className="fullscreen-overlay" onClick={() => setExpandedNodeId(null)}>
                    <div className="fullscreen-modal preview-modal" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close-btn" onClick={() => setExpandedNodeId(null)}>&times;</button>
                        <iframe srcDoc={expandedNode.html} title="Expanded View" sandbox="allow-scripts allow-same-origin" />
                    </div>
                </div>
            )}
        </div>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(<App />);
}
