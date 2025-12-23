
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
const LEVEL_GAP = 600;
const SIBLING_GAP = 400;
const GRID_SIZE = 40;

function App() {
    const [graph, setGraph] = useState<GraphState>({
        nodes: {},
        rootIds: [],
        selectedNodeIds: [],
        activeNodeId: null,
        nextLabelIndex: 1
    });
    
    const [view, setView] = useState({ x: window.innerWidth / 4, y: window.innerHeight / 4, zoom: 0.6 });
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [soloMode, setSoloMode] = useState(false);
    const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
    const [showCode, setShowCode] = useState(false);
    
    const canvasRef = useRef<HTMLDivElement>(null);
    const isPanning = useRef(false);
    const lastPos = useRef({ x: 0, y: 0 });
    const recognitionRef = useRef<any>(null);

    // Reingold-Tilford inspired layout logic
    const applyLayout = useCallback((nodes: Record<string, TreeNode>, rootIds: string[]) => {
        const childrenMap: Record<string, string[]> = {};
        Object.values(nodes).forEach(n => {
            if (n.parentId) {
                if (!childrenMap[n.parentId]) childrenMap[n.parentId] = [];
                childrenMap[n.parentId].push(n.id);
            }
        });

        const subtreeHeights: Record<string, number> = {};
        const calculateSubtreeHeight = (id: string): number => {
            const children = childrenMap[id] || [];
            if (children.length === 0) {
                subtreeHeights[id] = SIBLING_GAP;
                return SIBLING_GAP;
            }
            const totalHeight = children.reduce((acc, cid) => acc + calculateSubtreeHeight(cid), 0);
            subtreeHeights[id] = Math.max(SIBLING_GAP, totalHeight);
            return subtreeHeights[id];
        };

        rootIds.forEach(calculateSubtreeHeight);

        const newNodes = { ...nodes };
        const positionNode = (id: string, x: number, minY: number) => {
            const node = newNodes[id];
            const height = subtreeHeights[id];
            node.position = {
                x: x,
                y: minY + (height / 2) - 120 // Center relative to allocated block height
            };

            let currentY = minY;
            const children = childrenMap[id] || [];
            children.forEach(cid => {
                positionNode(cid, x + LEVEL_GAP, currentY);
                currentY += subtreeHeights[cid];
            });
        };

        let rootY = 0;
        rootIds.forEach(rid => {
            positionNode(rid, 100, rootY);
            rootY += subtreeHeights[rid];
        });

        return newNodes;
    }, []);

    // Stable Voice Transcription using Web Speech API
    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                let interimTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        setInputValue(prev => (prev.trim() + ' ' + event.results[i][0].transcript).trim());
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
            };

            recognition.onerror = (event: any) => {
                console.error("Speech Recognition Error", event.error);
                setIsListening(false);
            };

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

    const clearSelection = () => {
        setGraph(prev => ({ ...prev, selectedNodeIds: [], activeNodeId: null }));
    };

    const handleNodeDoubleClick = (id: string) => {
        setExpandedNodeId(id);
    };

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
                styleName: 'Designing...',
                html: '',
                status: 'streaming',
                depth: (primaryParent?.depth || 0) + 1,
                position: { x: 0, y: 0 }, // Will be set by layout
                childrenIds: [],
                indexLabel: `V${labelCounter++}`
            };
        }

        const nextRootIds = primaryParent ? graph.rootIds : [...graph.rootIds, ...newIds];
        const initialLayout = applyLayout(newNodesLocal, nextRootIds);

        // Auto-center view on the new primary variant
        const targetId = newIds[variantsCount === 1 ? 0 : 1];
        const targetNode = initialLayout[targetId];

        if (targetNode) {
            const nodeCenterX = targetNode.position.x + 160; 
            const nodeCenterY = targetNode.position.y + 120;
            
            setView(prev => ({
                ...prev,
                x: window.innerWidth / 2 - nodeCenterX * prev.zoom,
                y: window.innerHeight / 2 - nodeCenterY * prev.zoom
            }));
        }

        setGraph(prev => ({
            ...prev,
            nodes: initialLayout,
            rootIds: nextRootIds,
            selectedNodeIds: [targetId],
            activeNodeId: targetId,
            nextLabelIndex: labelCounter
        }));

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

            let baseContext = '';
            if (parents.length > 0) {
                baseContext = parents.map((p) => `### REFERENCE ${p.indexLabel}:\nStyle: ${p.styleName}\nCode: ${p.html}`).join('\n\n');
            }

            // Increase serendipity with more distinct visual metaphors
            const stylePrompt = `Create a JSON array of ${variantsCount} high-end, radically distinct design metaphors for: "${currentPrompt}". Ensure they feel like professional, high-fidelity products. Avoid "hacker" tropes unless specifically requested. Output only: ["Name 1", "Name 2", "Name 3"]`;
            const styleRes = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { role: 'user', parts: [{ text: stylePrompt }] }
            });
            const styles = JSON.parse(styleRes.text?.match(/\[.*\]/)?.[0] || '["Alpine Glass", "Industrial Brutalist", "Lumina Flow"]');

            const creativeDirectives = [
                "REIMAGINE. Completely break the existing layout. Surprise the user with a fresh structural perspective.",
                "REFINE. Keep the parent's logic but polish the typography, spacing, and micro-interactions to perfection.",
                "EXPERIMENTAL. Use bold color gradients, abstract SVG patterns, and unique navigation patterns."
            ];

            await Promise.all(newIds.map(async (id, idx) => {
                const styleName = styles[idx];
                const directive = creativeDirectives[idx % creativeDirectives.length];
                
                const finalPrompt = `You are a visionary UI Architect.
                GOAL: "${currentPrompt}"
                THEME: "${styleName}"
                DIRECTIVE: ${directive}

                ${baseContext ? `\n### EVOLVE FROM THESE REFERENCES:\n${baseContext}\n` : `\nSTART FRESH PROTOTYPE.\n`}

                RULES:
                1. Output ONLY valid, ready-to-run raw HTML/CSS. NO MARKDOWN.
                2. Adhere STRICTLY to user intent. (e.g. If they say 'Christmas', use festive palettes).
                3. The user may refer to variants by label (e.g. 'V1').
                4. Use modern CSS: Grid, Flexbox, Variable-based animations.
                5. Ensure components are robust and beautiful.`;

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

                setGraph(prev => ({ ...prev, nodes: { ...prev.nodes, [id]: { ...prev.nodes[id], html: fullHtml, status: 'complete' } } }));
            }));

        } catch (e) {
            console.error("Evolution sequence interrupted", e);
        } finally {
            setIsLoading(false);
        }
    };

    const activeNode = graph.activeNodeId ? graph.nodes[graph.activeNodeId] : null;
    const expandedNode = expandedNodeId ? graph.nodes[expandedNodeId] : null;

    // Selected labels for reference bar
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
                            style={{ left: node.position.x + 160, top: node.position.y + 120 }} 
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
                        
                        const x1 = parent.position.x + 320;
                        const y1 = parent.position.y + 120;
                        const x2 = node.position.x;
                        const y2 = node.position.y + 120;
                        
                        const isPrimary = graph.activeNodeId === node.id || graph.selectedNodeIds.includes(node.id);
                        
                        return (
                            <path 
                                key={`edge-${node.id}`}
                                className={`edge-path ${isPrimary ? 'active' : ''}`}
                                d={`M ${x1} ${y1} C ${x1 + 150} ${y1}, ${x2 - 150} ${y2}, ${x2} ${y2}`}
                                fill="none"
                                stroke={isPrimary ? "var(--accent-glow)" : "rgba(255,255,255,0.18)"}
                                strokeWidth={isPrimary ? "4" : "2"}
                                strokeOpacity={isPrimary ? "1" : "0.4"}
                                filter={isPrimary ? "url(#neon-glow)" : ""}
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
                                        <SparklesIcon /> {selectedLabels} ACTIVE
                                    </div>
                                    <button className="clear-selection" onClick={clearSelection}>Reset Context</button>
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
                                placeholder={isListening ? "Listening to your request..." : (graph.selectedNodeIds.length > 0 ? `Describe change for ${selectedLabels}...` : "Initiate a design flow...")}
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
                    <button className="control-btn" onClick={() => setView(v => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.25) }))}>+</button>
                    <button className="control-btn" onClick={() => setView(v => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom / 1.25) }))}>-</button>
                    <button className="control-btn" onClick={() => setShowCode(!showCode)}><CodeIcon /></button>
                    <button className="control-btn" onClick={() => activeNode && setView(v => ({ ...v, x: window.innerWidth / 2 - (activeNode.position.x * v.zoom), y: window.innerHeight / 2 - (activeNode.position.y * v.zoom) }))}><GridIcon /></button>
                </div>
            </div>

            {showCode && activeNode && (
                <div className="fullscreen-overlay" onClick={() => setShowCode(false)}>
                    <div className="fullscreen-modal code-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{activeNode.indexLabel} Architecture</h2>
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
