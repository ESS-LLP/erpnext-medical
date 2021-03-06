// Copyright (c) 2017, ESS LLP and contributors
// For license information, please see license.txt

frappe.ui.form.on('Clinical Procedure', {
	setup: function(frm) {
		frm.set_query('batch_no', 'items', function(doc, cdt, cdn) {
			let item = locals[cdt][cdn];
			if (!item.item_code) {
				frappe.throw(__('Please enter Item Code to get Batch Number'));
			} else {
				let filters = {'item_code': item.item_code};

				if (frm.doc.status == 'In Progress') {
					filters['posting_date'] = frm.doc.start_date || frappe.datetime.nowdate();
					if (frm.doc.warehouse) filters['warehouse'] = frm.doc.warehouse;
				}

				return {
					query : 'erpnext.controllers.queries.get_batch_no',
					filters: filters
				};
			}
		});
	},

	refresh: function(frm) {
		frm.set_query('patient', function () {
			return {
				filters: {'status': ['!=', 'Disabled']}
			};
		});

		frm.set_query('appointment', function () {
			return {
				filters: {
					'procedure_template': ['not in', null],
					'status': ['in', 'Open, Scheduled']
				}
			};
		});

		frm.set_query('service_unit', function() {
			return {
				filters: {
					'is_group': false,
					'allow_appointments': true,
					'company': frm.doc.company
				}
			};
		});

		frm.set_query('practitioner', function() {
			return {
				filters: {
					'department': frm.doc.medical_department
				}
			};
		});

		frm.set_query('referring_practitioner', function() {
			if(frm.doc.source == 'External Referral'){
				return {
					filters: {
						'healthcare_practitioner_type': 'External'
					}
				};
			}
			else{
				return {
					filters: {
						'healthcare_practitioner_type': 'Internal'
					}
				};
			}
		});

		if (frm.doc.consume_stock) {
			frm.set_indicator_formatter('item_code',
				function(doc) { return (doc.qty<=doc.actual_qty) ? 'green' : 'orange' ; });
		}

		if(frm.doc.__islocal) {
			frm.add_custom_button(__('Get from Patient Encounter'), function () {
				get_procedure_prescribed(frm);
			});
		}

		if (frm.doc.docstatus == 1) {
			if (frm.doc.status == 'In Progress') {
				let btn_label = '';
				let msg = '';
				if (frm.doc.consume_stock) {
					btn_label = __('Complete and Consume');
					msg = __('Complete {0} and Consume Stock?', [frm.doc.name]);
				} else {
					btn_label = 'Complete';
					msg = __('Complete {0}?', [frm.doc.name]);
				}

				frm.add_custom_button(__(btn_label), function () {
					frappe.confirm(
						msg,
						function() {
							frappe.call({
								method: 'complete_procedure',
								doc: frm.doc,
								freeze: true,
								callback: function(r) {
									if (r.message) {
										frappe.show_alert({
											message: __('Stock Entry {0} created', ['<a class="bold" href="#Form/Stock Entry/'+ r.message + '">' + r.message + '</a>']),
											indicator: 'green'
										});
									}
									frm.reload_doc();
								}
							});
						}
					);
				}).addClass("btn-primary");

			} else if (frm.doc.status == 'Pending') {
				frm.add_custom_button(__('Start'), function() {
					frappe.call({
						doc: frm.doc,
						method: 'start_procedure',
						callback: function(r) {
							if (!r.exc) {
								if (r.message == 'insufficient stock') {
									let msg = __('Stock quantity to start the Procedure is not available in the Warehouse {0}. Do you want to record a Stock Entry?', [frm.doc.warehouse.bold()]);
									frappe.confirm(
										msg,
										function() {
											frappe.call({
												doc: frm.doc,
												method: 'make_material_receipt',
												freeze: true,
												callback: function(r) {
													if (!r.exc) {
														frm.reload_doc();
														let doclist = frappe.model.sync(r.message);
														frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
													}
												}
											});
										}
									);
								} else {
									frm.reload_doc();
								}
							}
						}
					});
				}).addClass("btn-primary");
			}
		}
		frm.set_query('insurance_subscription', function(){
			return{
				filters:{
					'patient': frm.doc.patient,
					'docstatus': 1
				}
			};
		});
	},

	onload: function(frm) {
		if (frm.is_new()) {
			frm.add_fetch('procedure_template', 'medical_department', 'medical_department');
			frm.set_value('start_time', null);
		}
		if(frm.doc.source){
			set_source_referring_practitioner(frm)
		}
	},

	patient: function(frm) {
		if (frm.doc.patient) {
			frappe.call({
				'method': 'erpnext.healthcare.doctype.patient.patient.get_patient_detail',
				args: {
					patient: frm.doc.patient
				},
				callback: function (data) {
					let age = '';
					if (data.message.dob) {
						age = calculate_age(data.message.dob);
					} else if (data.message.age) {
						age = data.message.age;
						if (data.message.age_as_on) {
							age = __('{0} as on {1}', [age, data.message.age_as_on]);
						}
					}
					frm.set_value('patient_name', data.message.patient_name);
					frm.set_value('patient_age', age);
					frm.set_value('patient_sex', data.message.sex);
				}
			});
		} else {
			frm.set_value('patient_name', '');
			frm.set_value('patient_age', '');
			frm.set_value('patient_sex', '');
		}
	},

	appointment: function(frm) {
		if (frm.doc.appointment) {
			frappe.call({
				'method': 'frappe.client.get',
				args: {
					doctype: 'Patient Appointment',
					name: frm.doc.appointment
				},
				callback: function(data) {
					let values = {
						'patient':data.message.patient,
						'procedure_template': data.message.procedure_template,
						'medical_department': data.message.department,
						'practitioner': data.message.practitioner,
						'start_date': data.message.appointment_date,
						'start_time': data.message.appointment_time,
						'notes': data.message.notes,
						'service_unit': data.message.service_unit,
						'company': data.message.company,
						'source': data.message.source
					};
					frm.set_value(values);
				}
			});
		} else {
			let values = {
				'patient': '',
				'patient_name': '',
				'patient_sex': '',
				'patient_age': '',
				'medical_department': '',
				'procedure_template': '',
				'start_date': '',
				'start_time': '',
				'notes': '',
				'service_unit': '',
				'inpatient_record': ''
			};
			frm.set_value(values);
		}
	},

	procedure_template: function(frm) {
		if (frm.doc.procedure_template) {
			frappe.call({
				'method': 'frappe.client.get',
				args: {
					doctype: 'Clinical Procedure Template',
					name: frm.doc.procedure_template
				},
				callback: function (data) {
					frm.set_value('medical_department', data.message.medical_department);
					frm.set_value('consume_stock', data.message.consume_stock);
					frm.events.set_warehouse(frm);
					frm.events.set_procedure_consumables(frm);
				}
			});
		}
	},

	service_unit: function(frm) {
		if (frm.doc.service_unit) {
			frappe.call({
				method: 'frappe.client.get_value',
				args:{
					fieldname: 'warehouse',
					doctype: 'Healthcare Service Unit',
					filters:{name: frm.doc.service_unit},
				},
				callback: function(data) {
					if (data.message) {
						frm.set_value('warehouse', data.message.warehouse);
					}
				}
			});
		}
	},

	practitioner: function(frm) {
		if (frm.doc.practitioner) {
			frappe.call({
				'method': 'frappe.client.get',
				args: {
					doctype: 'Healthcare Practitioner',
					name: frm.doc.practitioner
				},
				callback: function (data) {
					frappe.model.set_value(frm.doctype,frm.docname, 'practitioner_name', data.message.practitioner_name);
				}
			});
		} else {
			frappe.model.set_value(frm.doctype,frm.docname, 'practitioner_name', '');
		}
	},

	set_warehouse: function(frm) {
		if (!frm.doc.warehouse) {
			frappe.call({
				method: 'frappe.client.get_value',
				args: {
					doctype: 'Stock Settings',
					fieldname: 'default_warehouse'
				},
				callback: function (data) {
					frm.set_value('warehouse', data.message.default_warehouse);
				}
			});
		}
	},

	set_procedure_consumables: function(frm) {
		frappe.call({
			method: 'erpnext.healthcare.doctype.clinical_procedure.clinical_procedure.get_procedure_consumables',
			args: {
				procedure_template: frm.doc.procedure_template
			},
			callback: function(data) {
				if (data.message) {
					frm.doc.items = [];
					$.each(data.message, function(i, v) {
						let item = frm.add_child('items');
						item.item_code = v.item_code;
						item.item_name = v.item_name;
						item.uom = v.uom;
						item.stock_uom = v.stock_uom;
						item.qty = flt(v.qty);
						item.transfer_qty = v.transfer_qty;
						item.conversion_factor = v.conversion_factor;
						item.invoice_separately_as_consumables = v.invoice_separately_as_consumables;
						item.batch_no = v.batch_no;
					});
					refresh_field('items');
				}
			}
		});
	},

	source: function(frm){
		if(frm.doc.source){
			set_source_referring_practitioner(frm);
		}
	}

});

frappe.ui.form.on('Clinical Procedure Item', {
	qty: function(frm, cdt, cdn) {
		let d = locals[cdt][cdn];
		frappe.model.set_value(cdt, cdn, 'transfer_qty', d.qty*d.conversion_factor);
	},

	uom: function(doc, cdt, cdn) {
		let d = locals[cdt][cdn];
		if (d.uom && d.item_code) {
			return frappe.call({
				method: 'erpnext.stock.doctype.stock_entry.stock_entry.get_uom_details',
				args: {
					item_code: d.item_code,
					uom: d.uom,
					qty: d.qty
				},
				callback: function(r) {
					if (r.message) {
						frappe.model.set_value(cdt, cdn, r.message);
					}
				}
			});
		}
	},

	item_code: function(frm, cdt, cdn) {
		let d = locals[cdt][cdn];
		let args = null;
		if (d.item_code) {
			args = {
				'doctype' : 'Clinical Procedure',
				'item_code' : d.item_code,
				'company' : frm.doc.company,
				'warehouse': frm.doc.warehouse
			};
			return frappe.call({
				method: 'erpnext.healthcare.doctype.clinical_procedure_template.clinical_procedure_template.get_item_details',
				args: {args: args},
				callback: function(r) {
					if (r.message) {
						let d = locals[cdt][cdn];
						$.each(r.message, function(k, v) {
							d[k] = v;
						});
						refresh_field('items');
					}
				}
			});
		}
	}
});

let get_procedure_prescribed = function(frm){
	if(frm.doc.patient){
		frappe.call({
			method:"erpnext.healthcare.doctype.clinical_procedure.clinical_procedure.get_procedure_prescribed",
			args: {patient: frm.doc.patient},
			callback: function(r){
				show_procedure_templates(frm, r.message);
			}
		});
	}
	else{
		frappe.msgprint("Please select Patient to get prescribed procedure");
	}
};

let calculate_age = function(birth) {
	let ageMS = Date.parse(Date()) - Date.parse(birth);
	let age = new Date();
	age.setTime(ageMS);
	let years =  age.getFullYear() - 1970;
	return  years + ' Year(s) ' + age.getMonth() + ' Month(s) ' + age.getDate() + ' Day(s)';
};

let set_source_referring_practitioner = function (frm) {
	if(frm.doc.source == 'Direct'){
		frm.set_value('referring_practitioner', '');
		frm.set_df_property('referring_practitioner', 'hidden', 1);
		frm.set_df_property('referring_practitioner', 'reqd', 0);
	}
	else if(frm.doc.source == 'External Referral' || frm.doc.source == 'Referral') {
		if(frm.doc.practitioner){
			frm.set_df_property('referring_practitioner', 'hidden', 0);
			if(frm.doc.source == 'External Referral'){
				frappe.db.get_value('Healthcare Practitioner', frm.doc.practitioner, 'healthcare_practitioner_type', function(r) {
					if(r && r.healthcare_practitioner_type && r.healthcare_practitioner_type == 'External'){
						frm.set_value('referring_practitioner', frm.doc.practitioner);
					}
					else{
						frm.set_value('referring_practitioner', '');
					}
				});
				frm.set_df_property('referring_practitioner', 'read_only', 0);
			}
			else{
				frappe.db.get_value('Healthcare Practitioner', frm.doc.practitioner, 'healthcare_practitioner_type', function(r) {
					if(r && r.healthcare_practitioner_type && r.healthcare_practitioner_type == 'Internal'){
						frm.set_value('referring_practitioner', frm.doc.practitioner);
						frm.set_df_property('referring_practitioner', 'read_only', 1);
					}
					else{
						frm.set_value('referring_practitioner', '');
						frm.set_df_property('referring_practitioner', 'read_only', 0);
					}
				});
			}
			frm.set_df_property('referring_practitioner', 'reqd', 1);
		}
		else{
			frm.set_df_property('referring_practitioner', 'read_only', 0);
			frm.set_df_property('referring_practitioner', 'hidden', 0);
			frm.set_df_property('referring_practitioner', 'reqd', 1);
		}
	}
};

// List Stock items
cur_frm.set_query('item_code', 'items', function() {
	return {
		filters: {
			is_stock_item:1
		}
	};
});

let show_procedure_templates = function(frm, result){
	var d = new frappe.ui.Dialog({
		title: __("Prescribed Procedures"),
		fields: [{
				fieldtype: "HTML", fieldname: "procedure_template"
		}]
	});
	var html_field = d.fields_dict.procedure_template.$wrapper;
	html_field.empty();
	$.each(result, function(x, y){
		var row = $(repl(
			'<div class="col-xs-12" style="padding-top:12px;">\
				<div class="col-xs-3"> %(procedure_template)s </div>\
				<div class="col-xs-4">%(encounter)s</div>\
				<div class="col-xs-3"> %(date)s </div>\
				<div class="col-xs-1">\
				<a data-name="%(name)s" data-procedure-template="%(procedure_template)s"\
					data-encounter="%(encounter)s" data-practitioner="%(practitioner)s"\
					data-invoiced="%(invoiced)s" data-source="%(source)s"\
					data-insurance-company="%(insurance_company)s" data-insurance-subscription="%(insurance_subscription)s"\
					data-referring-practitioner="%(referring_practitioner)s" href="#"><button class="btn btn-default btn-xs">Get</button></a>\
				</div>\
			</div><hr>',
			{ procedure_template: y[0], encounter: y[1], invoiced: y[2], practitioner: y[3], date: y[4], source: y[5], referring_practitioner: y[6],
				name: y[7], insurance_subscription:y[8], insurance_company:y[9]})
			).appendTo(html_field);
			row.find("a").click(function() {
			frm.doc.procedure_template = $(this).attr("data-procedure-template");
			frm.doc.healthcare_service_order = $(this).attr('data-name');
			frm.doc.practitioner = $(this).attr("data-practitioner");
			frm.doc.source =  $(this).attr("data-source");
			frm.set_df_property("source", "read_only", 1);
			frm.doc.referring_practitioner= $(this).attr("data-referring-practitioner");
			frm.doc.insurance_subscription = $(this).attr("data-insurance-subscription");
			frm.doc.insurance_company = $(this).attr("data-insurance-company");
			if(frm.doc.insurance){
				frm.set_df_property("insurance_subscription", "read_only", 1);
			}
			if(frm.doc.referring_practitioner){
				frm.set_df_property("referring_practitioner", "hidden", 0);
				frm.set_df_property("referring_practitioner", "read_only", 1);
			}
			frm.doc.invoiced = 0;
			if ($(this).attr('data-invoiced') === 1) {
				frm.doc.invoiced = 1;
			}
			frm.refresh_field("procedure_template");
			frm.refresh_field("healthcare_service_order");
			frm.refresh_field("practitioner");
			frm.refresh_field("source");
			frm.refresh_field("referring_practitioner");
			frm.refresh_field('insurance_subscription');
			frm.refresh_field("insurance_company");
			frm.refresh_field('invoiced');
			d.hide();
			return false;
		});
	});
	if(!result || result.length < 1){
		var msg = "There are no procedure prescribed for patient "+frm.doc.patient;
		$(repl('<div class="text-left">%(msg)s</div>', {msg: msg})).appendTo(html_field);
	}
	d.show();
};

