// src/components/CustomerForm.jsx — v2025-11-11 post to canonical /projects/homeowners/
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";

const US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],
  ["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],
  ["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],
  ["WI","Wisconsin"],["WY","Wyoming"],
];

function formatZip(value){const d=String(value||"").replace(/\D/g,"").slice(0,9);return d.length<=5?d:`${d.slice(0,5)}-${d.slice(5)}`;}
function isValidZip(zip){if(!zip)return true;return /^\d{5}(-\d{4})?$/.test(zip);}
function formatPhoneUS(value){let d=String(value||"").replace(/\D/g,"");if(d.length===11&&d.startsWith("1"))d=d.slice(1);if(d.length<=3)return d;if(d.length<=6)return`(${d.slice(0,3)}) ${d.slice(3)}`;return`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;}
function isValidUSPhone(input){const d=String(input||"").replace(/\D/g,"");return d.length===10||(d.length===11&&d.startsWith("1"));}

export default function CustomerForm(){
  const navigate=useNavigate();
  const [form,setForm]=useState({full_name:"",email:"",phone_number:"",street_address:"",address_line_2:"",city:"",state:"",zip_code:"",status:"active"});
  const [isSaving,setIsSaving]=useState(false);

  const handleChange=(e)=>{const {name,value}=e.target;
    if(name==="zip_code")return setForm(p=>({...p,zip_code:formatZip(value)}));
    if(name==="phone_number")return setForm(p=>({...p,phone_number:formatPhoneUS(value)}));
    setForm(p=>({...p,[name]:value}));
  };

  function buildPayload(src){const out={};for(const [k,v] of Object.entries(src)){out[k]=k==="phone_number"?String(v||"").replace(/\D/g,""):(typeof v==="string"?v.trim():v);}return out;}
  function parseError(err){const data=err?.response?.data;if(!data)return"Failed to create customer.";if(typeof data==="string")return data;if(Array.isArray(data))return data[0]||"Failed to create customer.";if(data.detail)return String(data.detail);const first=Object.keys(data)[0];const val=data[first];if(Array.isArray(val))return`${first}: ${val[0]}`;return`${first}: ${String(val)}`;}

  const handleSubmit=async(e)=>{e.preventDefault();
    if(!isValidUSPhone(form.phone_number))return toast.error("Enter a valid US phone (10 digits, or +1 then 10 digits).");
    if(!isValidZip(form.zip_code))return toast.error("ZIP code must be 5 digits or 9 digits (ZIP+4).");
    if(!form.state)return toast.error("Please select a state.");

    setIsSaving(true);
    try{
      await api.post("/projects/homeowners/", buildPayload(form)); // canonical path (no alias) :contentReference[oaicite:7]{index=7}
      toast.success("Customer created successfully!"); navigate("/customers");
    }catch(err){
      const status=err?.response?.status;
      if(status===403){ toast.error("Please finish contractor onboarding to add customers."); try{window.dispatchEvent(new CustomEvent("mhb:onboardingRequired",{detail:{source:"homeowners:create"}}));}catch{} window.location.assign("/onboarding"); return; }
      toast.error(parseError(err));
    }finally{ setIsSaving(false); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Create New Customer</h2>
      <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-md space-y-8" noValidate>
        <div className="space-y-6">
          <h3 className="text-lg font-medium text-gray-900">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div><label className="block text-sm font-medium text-gray-700">Full Name</label>
              <input name="full_name" value={form.full_name} onChange={handleChange} required autoComplete="name" className="w-full px-3 py-2 border rounded shadow-sm"/></div>
            <div><label className="block text-sm font-medium text-gray-700">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required autoComplete="email" className="w-full px-3 py-2 border rounded shadow-sm"/></div>
            <div><label className="block text-sm font-medium text-gray-700">Phone Number</label>
              <input name="phone_number" type="tel" value={form.phone_number} onChange={handleChange} placeholder="(555) 555-5555" autoComplete="tel" inputMode="tel" maxLength={14} className="w-full px-3 py-2 border rounded shadow-sm" title="Enter a valid US phone number, e.g. (210) 555-1234"/>
              <p className="mt-1 text-xs text-gray-500">Accepts (210) 555-1234, 210-555-1234, 210 555 1234, +1 210 555 1234</p></div>
            <div><label className="block text-sm font-medium text-gray-700">Status</label>
              <select name="status" value={form.status} onChange={handleChange} className="w-full px-3 py-2 border rounded shadow-sm">
                <option value="active">Active</option><option value="prospect">Prospect</option><option value="archived">Archived</option>
              </select></div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-8 space-y-6">
          <h3 className="text-lg font-medium text-gray-900">Address</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2"><label className="block text-sm font-medium text-gray-700">Street Address</label>
              <input name="street_address" value={form.street_address} onChange={handleChange} autoComplete="address-line1" className="w-full px-3 py-2 border rounded shadow-sm"/></div>
            <div className="md:col-span-2"><label className="block text-sm font-medium text-gray-700">Address Line 2</label>
              <input name="address_line_2" value={form.address_line_2} onChange={handleChange} autoComplete="address-line2" className="w-full px-3 py-2 border rounded shadow-sm"/></div>
            <div><label className="block text-sm font-medium text-gray-700">City</label>
              <input name="city" value={form.city} onChange={handleChange} autoComplete="address-level2" className="w-full px-3 py-2 border rounded shadow-sm"/></div>
            <div><label className="block text-sm font-medium text-gray-700">State</label>
              <select name="state" value={form.state} onChange={handleChange} required autoComplete="address-level1" className="w-full px-3 py-2 border rounded shadow-sm">
                <option value="" disabled>Select state…</option>
                {US_STATES.map(([code,name])=><option key={code} value={code}>{name} ({code})</option>)}
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700">ZIP Code</label>
              <input name="zip_code" value={form.zip_code} onChange={handleChange} autoComplete="postal-code" inputMode="numeric" maxLength={10} placeholder="12345 or 12345-6789" className="w-full px-3 py-2 border rounded shadow-sm"/>
              <p className="mt-1 text-xs text-gray-500">We’ll auto-format as you type; 5 or 9 digits (ZIP+4) accepted.</p></div>
          </div>
        </div>

        <div className="pt-5 border-t border-gray-200 flex justify-end">
          <button type="button" onClick={()=>navigate("/customers")} disabled={isSaving} className="bg-white py-2 px-4 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={isSaving} className="ml-3 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm shadow disabled:bg-gray-400">
            {isSaving?"Creating...":"Create Customer"}
          </button>
        </div>
      </form>
    </div>
  );
}
