var math = require("./util/math.js")();
var linkCreator = require("./parsing/linkCreator.js")();
var elementTools = require("./util/elementTools.js")();


module.exports = function (graphContainerSelector) {
	var graph = {},
		CARDINALITY_HDISTANCE = 20,
		CARDINALITY_VDISTANCE = 10,
		curveFunction = d3.svg.line()
			.x(function (d) {
				return d.x;
			})
			.y(function (d) {
				return d.y;
			})
			.interpolate("cardinal"),
		options = require("./options.js")(),
		parser = require("./parser.js")(graph),
		language = "default",
	// Container for visual elements
		graphContainer,
		nodeContainer,
		labelContainer,
		cardinalityContainer,
		linkContainer,
	// Visual elements
		nodeElements,
		labelGroupElements,
		linkGroups,
		linkPathElements,
		cardinalityElements,
	// Internal data
		nodes,
		properties,
		unfilteredNodes,
		unfilteredProperties,
		links,
	// Graph behaviour
		force,
		dragBehaviour,
		zoom;

	/**
	 * Recalculates the positions of nodes, links, ... and updates them.
	 */
	function recalculatePositions() {
		// Set node positions
		nodeElements.attr("transform", function (node) {
			return "translate(" + node.x + "," + node.y + ")";
		});

		// Set link paths and calculate additional informations
		linkPathElements.attr("d", function (l) {
			if (l.domain() === l.range()) {
				return math.calculateLoopPath(l);
			}

			// Calculate these every time to get nicer curved paths
			var pathStart = math.calculateIntersection(l.range(), l.domain(), 1),
				pathEnd = math.calculateIntersection(l.domain(), l.range(), 1),
				linkDistance = getVisibleLinkDistance(l),
				curvePoint = math.calculateCurvePoint(pathStart, pathEnd, l,
					linkDistance / options.defaultLinkDistance());

			l.curvePoint(curvePoint);

			return curveFunction([math.calculateIntersection(l.curvePoint(), l.domain(), 1),
				curvePoint, math.calculateIntersection(l.curvePoint(), l.range(), 1)]);
		});

		// Set label group positions
		labelGroupElements.attr("transform", function (link) {
			var posX = link.curvePoint().x,
				posY = link.curvePoint().y;

			return "translate(" + posX + "," + posY + ")";
		});


		// Set cardinality positions
		cardinalityElements.attr("transform", function (p) {
			var curve = p.link().curvePoint(),
				pos = math.calculateIntersection(curve, p.range(), CARDINALITY_HDISTANCE),
				normalV = math.calculateNormalVector(curve, p.domain(), CARDINALITY_VDISTANCE);

			return "translate(" + (pos.x + normalV.x) + "," + (pos.y + normalV.y) + ")";
		});
	}

	/**
	 * Adjusts the containers current scale and position.
	 */
	function zoomed() {
		graphContainer.attr("transform", "translate(" + d3.event.translate + ")scale(" + d3.event.scale + ")");
	}

	/**
	 * Initializes the graph.
	 */
	function initializeGraph() {
		options.graphContainerSelector(graphContainerSelector);

		force = d3.layout.force()
			.on("tick", recalculatePositions);

		dragBehaviour = d3.behavior.drag()
			.origin(function (d) {
				return d;
			})
			.on("dragstart", function (d) {
				d3.event.sourceEvent.stopPropagation(); // Prevent panning
				d.locked(true);
			})
			.on("drag", function (d) {
				d.px = d3.event.x;
				d.py = d3.event.y;
				force.resume();
			})
			.on("dragend", function (d) {
				d.locked(false);
			});

		// Apply the zooming factor.
		zoom = d3.behavior.zoom()
			.duration(150)
			.scaleExtent([options.minMagnification(), options.maxMagnification()])
			.on("zoom", zoomed);

	}

	initializeGraph();

	/**
	 * Returns the graph options of this graph (readonly).
	 * @returns {webvowl.options} a graph options object
	 */
	graph.graphOptions = function () {
		return options;
	};

	/**
	 * Loads all settings, removes the old graph (if it exists) and draws a new one.
	 */
	graph.start = function () {
		force.stop();
		loadGraphData();
		redrawGraph();
		graph.update();
	};

	/**
	 * Updates only the style of the graph.
	 */
	graph.updateStyle = function () {
		refreshGraphStyle();
		force.start();
	};

	graph.reload = function () {
		loadGraphData();
		this.update();
	};

	/**
	 * Updates the graphs displayed data and style.
	 */
	graph.update = function () {
		refreshGraphData();
		refreshGraphStyle();
		force.start();
		redrawContent();
	};

	/**
	 * Stops the influence of the force directed layout on all nodes. They are still manually movable.
	 */
	graph.freeze = function () {
		if (nodes) {
			nodes.forEach(function (n) {
				n.frozen(true);
			});
		}
	};

	/**
	 * Allows the influence of the force directed layout on all nodes.
	 */
	graph.unfreeze = function () {
		if (nodes) {
			nodes.forEach(function (n) {
				n.frozen(false);
			});
			force.resume();
		}
	};

	/**
	 * Resets visual settings like zoom or panning.
	 */
	graph.reset = function () {
		zoom.translate([0, 0])
			.scale(1);
	};

	/**
	 * Calculate the complete link distance. The visual link distance does
	 * not contain e.g. radii of round nodes.
	 * @param link the link
	 * @returns {*}
	 */
	function calculateLinkDistance(link) {
		var distance = getVisibleLinkDistance(link);
		distance += link.domain().actualRadius();
		distance += link.range().actualRadius();
		return distance;
	}

	function getVisibleLinkDistance(link) {
		if (elementTools.isDatatype(link.domain()) || elementTools.isDatatype(link.range())) {
			return options.datatypeDistance();
		} else {
			return options.classDistance();
		}
	}

	/**
	 * Empties the last graph container and draws a new one with respect to the
	 * value the graph container selector has.
	 */
	function redrawGraph() {
		remove();

		graphContainer = d3.selectAll(options.graphContainerSelector())
			.append("svg")
			.classed("vowlGraph", true)
			.attr("width", options.width())
			.attr("height", options.height())
			.call(zoom)
			.append("g");
	}

	/**
	 * Redraws all elements like nodes, links, ...
	 */
	function redrawContent() {
		var markerContainer;

		if (!graphContainer) {
			return;
		}

		// Empty the graph container
		graphContainer.selectAll("*").remove();

		// Last container -> elements of this container overlap others
		linkContainer = graphContainer.append("g").classed("linkContainer", true);
		cardinalityContainer = graphContainer.append("g").classed("cardinalityContainer", true);
		labelContainer = graphContainer.append("g").classed("labelContainer", true);
		nodeContainer = graphContainer.append("g").classed("nodeContainer", true);

		// Add an extra container for all markers
		markerContainer = linkContainer.append("defs");

		// Draw nodes
		nodeElements = nodeContainer.selectAll(".node")
			.data(nodes).enter()
			.append("g")
			.classed("node", true)
			.attr("id", function (d) {
				return d.id();
			})
			.call(dragBehaviour);

		nodeElements.each(function (d) {
			d.drawNode(d3.select(this));
		});


		// Draw label groups (property + inverse)
		labelGroupElements = labelContainer.selectAll(".labelGroup")
			.data(links).enter()
			.append("g")
			.classed("labelGroup", true);

		labelGroupElements.each(function (link) {
			var success = link.property().drawProperty(d3.select(this));
			// Remove empty groups without a label.
			if (!success) {
				d3.select(this).remove();
			}
		});

		// Place subclass label groups on the bottom of all labels
		labelGroupElements.each(function (link) {
			// the label might be hidden e.g. in compact notation
			if (!this.parentNode) {
				return;
			}

			if (elementTools.isRdfsSubClassOf(link.property())) {
				var parentNode = this.parentNode;
				parentNode.insertBefore(this, parentNode.firstChild);
			}
		});

		// Draw cardinalities
		cardinalityElements = cardinalityContainer.selectAll(".cardinality")
			.data(properties).enter()
			.append("g")
			.classed("cardinality", true);

		cardinalityElements.each(function (property) {
			var success = property.drawCardinality(d3.select(this));

			// Remove empty groups without a label.
			if (!success) {
				d3.select(this).remove();
			}
		});

		// Draw links
		linkGroups = linkContainer.selectAll(".link")
			.data(links).enter()
			.append("g")
			.classed("link", true);

		linkGroups.each(function (link) {
			link.drawLink(d3.select(this), markerContainer);
		});

		// Select the path for direct access to receive a better performance
		linkPathElements = linkGroups.selectAll("path");

		addClickEvents();
	}

	/**
	 * Applies click listeneres to nodes and properties.
	 */
	function addClickEvents() {
		function executeModules(selectedElement) {
			options.selectionModules().forEach(function (module) {
				module.handle(selectedElement);
			});
		}

		nodeElements.on("click", function (clickedNode) {
			executeModules(clickedNode);
		});

		labelGroupElements.selectAll(".label").on("click", function (clickedProperty) {
			executeModules(clickedProperty);
		});
	}

	function loadGraphData() {
		parser.parse(options.data());

		unfilteredNodes = parser.nodes();
		unfilteredProperties = parser.properties();
	}

	/**
	 * Applies the data of the graph options object and parses it. The graph is not redrawn.
	 */
	function refreshGraphData() {
		var preprocessedNodes = unfilteredNodes,
			preprocessedProperties = unfilteredProperties;

		// Filter the data
		options.filterModules().forEach(function (module) {
			links = linkCreator.createLinks(preprocessedProperties);
			storeLinksOnNodes(preprocessedNodes, links);

			module.filter(preprocessedNodes, preprocessedProperties);
			preprocessedNodes = module.filteredNodes();
			preprocessedProperties = module.filteredProperties();
		});

		nodes = preprocessedNodes;
		properties = preprocessedProperties;
		links = linkCreator.createLinks(properties);

		storeLinksOnNodes(nodes, links);

		force.nodes(nodes)
			.links(links);
	}

	function storeLinksOnNodes(nodes, links) {
		for (var i = 0, nodesLength = nodes.length; i < nodesLength; i++) {
			var node = nodes[i],
				connectedLinks = [];

			// look for properties where this node is the domain or range
			for (var j = 0, linksLength = links.length; j < linksLength; j++) {
				var link = links[j];

				if (link.domain() === node || link.range() === node) {
					connectedLinks.push(link);
				}
			}

			node.links(connectedLinks);
		}
	}


	/**
	 * Applies all options that don't change the graph data.
	 */
	function refreshGraphStyle() {
		zoom = zoom.scaleExtent([options.minMagnification(), options.maxMagnification()]);
		if (graphContainer) {
			zoom.event(graphContainer);
		}

		force.charge(options.charge())
			.size([options.width(), options.height()])
			.linkDistance(calculateLinkDistance)
			.gravity(options.gravity())
			.linkStrength(options.linkStrength()); // Flexibility of links
	}

	/**
	 * Removes all elements from the graph container.
	 */
	function remove() {
		if (graphContainer) {
			// Select the parent element because the graph container is a group (e.g. for zooming)
			d3.select(graphContainer.node().parentNode).remove();
		}
	}

	graph.options = function () {
		return options;
	};

	graph.language = function (newLanguage) {
		if (!arguments.length) return language;

		// Just update if the language changes
		if (language !== newLanguage) {
			language = newLanguage || "default";
			redrawContent();
			recalculatePositions();
		}
		return graph;
	};


	return graph;
};